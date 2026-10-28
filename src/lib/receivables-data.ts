import { createClient } from "@/lib/supabase/server";
import { withRunningBalance, type StatementFilter } from "@/lib/ledger";
import { RECEIPT_METHOD } from "@/lib/labels";
import { formatDate } from "@/lib/format";

export type ClientStatementLine = {
  key: string;
  date: string;
  kind: "invoice" | "receipt" | "bounced";
  docId: string;
  docNo: number;
  description: string;
  details: string | null;
  debit_minor: number;
  credit_minor: number;
  balance_minor: number;
};

/**
 * A customer's statement for a period: invoices (debit), receipts (credit) and
 * bounced cheques (debit again), with the opening balance and running balance.
 */
export async function loadClientStatement(clientId: string, f: StatementFilter) {
  const supabase = await createClient();
  const [clientRes, rowsRes, receiptsRes, balanceRes] = await Promise.all([
    supabase.from("clients").select("id, name, tax_number, phone, address, city, payment_terms_days, vat_exempt").eq("id", clientId).maybeSingle(),
    supabase
      .from("client_statement_v")
      .select("*")
      .eq("client_id", clientId)
      .lte("entry_date", f.to)
      .order("entry_date")
      .order("kind_order")
      .order("doc_no"),
    supabase.from("client_receipts").select("id, cheque_no, cheque_bank, cheque_due_date, cheque_status, reference_no, notes").eq("client_id", clientId),
    supabase.from("client_balance_v").select("*").eq("client_id", clientId).maybeSingle(),
  ]);
  const client = clientRes.data;
  if (!client) return null;
  const receipts = new Map((receiptsRes.data ?? []).map((r) => [r.id, r]));
  const all = rowsRes.data ?? [];
  const before = all.filter((r) => (r.entry_date ?? "") < f.from);
  const inRange = all.filter((r) => (r.entry_date ?? "") >= f.from);
  const opening = before.reduce((s, r) => s + (r.debit_minor ?? 0) - (r.credit_minor ?? 0), 0);

  const lines = withRunningBalance(
    opening,
    inRange.map((r) => {
      const rc = r.doc_id ? receipts.get(r.doc_id) : undefined;
      const kind = r.kind as ClientStatementLine["kind"];
      let description = "";
      let details: string | null = null;
      if (kind === "invoice") {
        description = `فاتورة رقم ${r.doc_no}`;
        details = `${r.lines_count} نقلة · ${formatDate(r.period_from)} – ${formatDate(r.period_to)}`;
      } else if (kind === "receipt") {
        description = `سند قبض رقم ${r.doc_no} · ${RECEIPT_METHOD[r.method ?? ""] ?? r.method}`;
        if (rc?.cheque_no) details = `شيك ${rc.cheque_no}${rc.cheque_bank ? ` · ${rc.cheque_bank}` : ""} · يستحق ${formatDate(rc.cheque_due_date)}`;
        else if (rc?.reference_no) details = rc.reference_no;
        if (rc?.notes) details = details ? `${details} · ${rc.notes}` : rc.notes;
      } else {
        description = `شيك مرتجع (سند رقم ${r.doc_no})`;
        details = rc?.cheque_no ? `شيك ${rc.cheque_no}` : null;
      }
      return {
        key: `${kind}-${r.doc_id}`,
        date: r.entry_date!,
        kind,
        docId: r.doc_id!,
        docNo: r.doc_no!,
        description,
        details,
        debit_minor: r.debit_minor ?? 0,
        credit_minor: r.credit_minor ?? 0,
      };
    }),
  );
  const debit = lines.reduce((s, l) => s + l.debit_minor, 0);
  const credit = lines.reduce((s, l) => s + l.credit_minor, 0);
  return { client, balance: balanceRes.data, opening, lines, debit, credit, closing: opening + debit - credit };
}
