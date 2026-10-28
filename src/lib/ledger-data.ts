import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/date-range";
import { statementAccounts, withRunningBalance, type StatementFilter } from "@/lib/ledger";

export type StatementLine = {
  id: string;
  entry_id: string;
  entry_no: number;
  entry_date: string;
  description: string;
  status: string;
  source_type: string | null;
  source_id: string | null;
  is_reversal: boolean;
  account: string;
  party: string | null;
  customs_declaration_no: string | null;
  voucher_no: string | null;
  notice_no: string | null;
  reference_no: string | null;
  notes: string | null;
  invoice_no: number | null;
  receipt_no: number | null;
  cheque_no: string | null;
  payment_no: number | null;
  debit_minor: number;
  credit_minor: number;
  balance_minor: number;
};

export type Statement = {
  title: string;
  multiAccount: boolean;
  opening: number;
  lines: StatementLine[];
  debit: number;
  credit: number;
  closing: number;
  /** The period has more lines than one page shows. */
  truncated: boolean;
};

const MAX_LINES = 1000;

/**
 * An account statement for a period: opening balance, then every line with
 * its documents and the running balance. `key` is an account id (a parent
 * account covers the accounts under it) or "expenses" for all expense accounts.
 */
export async function loadStatement(key: string, f: StatementFilter): Promise<Statement | null> {
  const supabase = await createClient();
  const { data: accounts } = await supabase.from("accounts").select("id, code, name_ar, parent_id, is_postable, type");
  const ids = statementAccounts(key, accounts ?? []);
  if (ids.length === 0) return null;
  const root = accounts?.find((a) => a.id === key);
  const title = key === "expenses" ? "كل حسابات المصاريف" : `${root?.code} ${root?.name_ar}`;

  let q = supabase
    .from("ledger_lines_v")
    .select(
      "id, entry_id, entry_no, entry_date, entry_description, status, source_type, source_id, reverses_entry_id, account_code, account_name, truck_code, supplier_name, driver_name, client_name, customs_declaration_no, voucher_no, notice_no, reference_no, notes, invoice_no, receipt_no, cheque_no, payment_no, debit_minor, credit_minor",
    )
    .in("account_id", ids)
    .gte("entry_date", f.from)
    .lte("entry_date", f.to)
    .order("entry_date")
    .order("entry_no")
    .order("line_no")
    .range(0, MAX_LINES - 1);
  if (f.truck) q = q.eq("truck_id", f.truck);
  if (f.supplier) q = q.eq("supplier_id", f.supplier);
  if (f.driver) q = q.eq("driver_id", f.driver);
  if (f.client) q = q.eq("client_id", f.client);

  const [linesRes, openingRes] = await Promise.all([
    q,
    supabase.rpc("account_balance_before", {
      p_account_ids: ids,
      p_before: f.from,
      p_truck_id: f.truck || undefined,
      p_supplier_id: f.supplier || undefined,
      p_driver_id: f.driver || undefined,
      p_client_id: f.client || undefined,
    }),
  ]);
  const opening = Number(openingRes.data ?? 0);
  const raw = linesRes.data ?? [];
  const lines = withRunningBalance(
    opening,
    raw.map((l) => ({
      id: l.id!,
      entry_id: l.entry_id!,
      entry_no: l.entry_no!,
      entry_date: l.entry_date!,
      description: l.entry_description ?? "",
      status: l.status ?? "posted",
      source_type: l.source_type,
      source_id: l.source_id,
      is_reversal: Boolean(l.reverses_entry_id),
      account: `${l.account_code} ${l.account_name}`,
      party: [l.truck_code, l.supplier_name, l.driver_name, l.client_name].filter(Boolean).join(" · ") || null,
      customs_declaration_no: l.customs_declaration_no,
      voucher_no: l.voucher_no,
      notice_no: l.notice_no,
      reference_no: l.reference_no,
      notes: l.notes,
      invoice_no: l.invoice_no,
      receipt_no: l.receipt_no,
      cheque_no: l.cheque_no,
      payment_no: l.payment_no,
      debit_minor: l.debit_minor ?? 0,
      credit_minor: l.credit_minor ?? 0,
    })),
  );
  const debit = lines.reduce((s, l) => s + l.debit_minor, 0);
  const credit = lines.reduce((s, l) => s + l.credit_minor, 0);
  return {
    title,
    multiAccount: ids.length > 1,
    opening,
    lines,
    debit,
    credit,
    closing: opening + debit - credit,
    truncated: raw.length === MAX_LINES,
  };
}

/** Trucks, suppliers, drivers and customers for the statement filters. */
export async function loadStatementParties() {
  const supabase = await createClient();
  const [trucks, suppliers, drivers, clients] = await Promise.all([
    supabase.from("trucks").select("id, code").order("code"),
    supabase.from("suppliers").select("id, name").order("name"),
    supabase.from("drivers").select("id, full_name").order("full_name"),
    supabase.from("clients").select("id, name").order("name"),
  ]);
  return {
    clients: (clients.data ?? []).map((c) => ({ id: c.id, label: c.name })),
    trucks: (trucks.data ?? []).map((t) => ({ id: t.id, label: t.code })),
    suppliers: (suppliers.data ?? []).map((s) => ({ id: s.id, label: s.name })),
    drivers: (drivers.data ?? []).map((d) => ({ id: d.id, label: d.full_name })),
  };
}

/** The exclusive end date the trial balance function takes. */
export const dayAfter = (iso: string) => addDays(iso, 1);
