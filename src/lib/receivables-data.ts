import { createClient } from "@/lib/supabase/server";
import { withRunningBalance, type StatementFilter } from "@/lib/ledger";
import { RECEIPT_METHOD } from "@/lib/labels";
import { formatDate } from "@/lib/format";

export type ClientStatementLine = {
  key: string;
  date: string;
  kind: "opening" | "invoice" | "receipt" | "bounced";
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
      if (kind === "opening") {
        description = "رصيد افتتاحي";
        details = "رصيد الزبون يوم بدء العمل";
      } else if (kind === "invoice") {
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

/** Every row of a query, page by page: the API returns at most 1,000 rows at a time. */
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>, max = 20_000): Promise<T[]> {
  const size = 1000;
  const out: T[] = [];
  for (let from = 0; from < max; from += size) {
    const { data } = await page(from, from + size - 1);
    out.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return out;
}

const name = (v: unknown, key: "code" | "name") => (v as Record<string, string> | null)?.[key] ?? null;

export type ClientLoad = {
  id: string;
  ref: string | null;
  date: string;
  truckCode: string | null;
  route: string;
  cargo: string | null;
  docNo: string | null;
  currency: string;
  freightMinor: number;
  amountMinor: number;
  invoiceId: string | null;
};

const LOAD_SELECT =
  "id, client_ref, start_date, client_doc_no, cargo_description, currency, freight_minor, freight_base_minor, invoice_id, truck:trucks(code), from_loc:locations!trips_from_location_id_fkey(name), to_loc:locations!trips_to_location_id_fkey(name)";

type LoadRow = {
  id: string;
  client_ref: string | null;
  start_date: string;
  client_doc_no: string | null;
  cargo_description: string | null;
  currency: string;
  freight_minor: number;
  freight_base_minor: number;
  invoice_id: string | null;
  truck: unknown;
  from_loc: unknown;
  to_loc: unknown;
};

function toLoad(r: LoadRow): ClientLoad {
  return {
    id: r.id,
    ref: r.client_ref,
    date: r.start_date,
    truckCode: name(r.truck, "code"),
    route: `${name(r.from_loc, "name") ?? "—"} ← ${name(r.to_loc, "name") ?? "—"}`,
    cargo: r.cargo_description,
    docNo: r.client_doc_no,
    currency: r.currency,
    freightMinor: r.freight_minor,
    amountMinor: r.freight_base_minor,
    invoiceId: r.invoice_id,
  };
}

/**
 * A customer's loads for the statement (the same loads the balance counts:
 * finished, not an empty return, with freight):
 * - every load not invoiced yet, whatever its date;
 * - the loads of the period, for the counts per month;
 * - every issued invoice (for how far each is paid) and the loads on the period's invoices.
 */
export async function loadClientLoads(clientId: string, f: StatementFilter) {
  const supabase = await createClient();
  const loads = () =>
    supabase
      .from("trips")
      .select(LOAD_SELECT)
      .eq("client_id", clientId)
      .eq("status", "completed")
      .eq("is_empty_return", false)
      .gt("freight_base_minor", 0);
  const [unbilled, period, invoicesRes, lines] = await Promise.all([
    allRows((a, b) => loads().is("invoice_id", null).order("start_date").order("trip_no").range(a, b)),
    allRows((a, b) =>
      supabase
        .from("trips")
        .select("start_date, freight_base_minor, invoice_id")
        .eq("client_id", clientId)
        .eq("status", "completed")
        .eq("is_empty_return", false)
        .gt("freight_base_minor", 0)
        .gte("start_date", f.from)
        .lte("start_date", f.to)
        .order("start_date")
        .order("trip_no")
        .range(a, b),
    ),
    supabase
      .from("invoices")
      .select("id, invoice_no, invoice_date, due_date, total_minor, lines_count")
      .eq("client_id", clientId)
      .eq("status", "issued")
      .order("invoice_date")
      .order("invoice_no")
      .limit(5000),
    allRows((a, b) =>
      supabase
        .from("invoice_lines")
        .select("invoice_id, line_no, trip_id, load_date, client_ref, client_doc_no, route, cargo_description, amount_minor, invoices!inner(client_id, status, invoice_date)")
        .eq("invoices.client_id", clientId)
        .eq("invoices.status", "issued")
        .gte("invoices.invoice_date", f.from)
        .lte("invoices.invoice_date", f.to)
        .order("invoice_id")
        .order("line_no")
        .range(a, b),
    ),
  ]);
  const byInvoice = new Map<string, typeof lines>();
  for (const l of lines) {
    const list = byInvoice.get(l.invoice_id) ?? [];
    list.push(l);
    byInvoice.set(l.invoice_id, list);
  }
  return {
    unbilled: unbilled.map((r) => toLoad(r as LoadRow)),
    period: period.map((r) => ({ date: r.start_date, invoiced: r.invoice_id !== null, amount_minor: r.freight_base_minor })),
    invoices: invoicesRes.data ?? [],
    linesByInvoice: byInvoice,
  };
}

/** Loads whose reference number (or the customer's own document number) is what was typed, newest first. */
export async function findLoadsByRef(refs: string[], raw: string) {
  if (refs.length === 0) return [];
  const supabase = await createClient();
  const select = `${LOAD_SELECT}, client_id, status, is_empty_return, client:clients(name)`;
  const [byRef, byDoc] = await Promise.all([
    supabase.from("trips").select(select).in("client_ref", refs).order("start_date", { ascending: false }).limit(20),
    supabase.from("trips").select(select).eq("client_doc_no", raw.trim()).not("client_id", "is", null).order("start_date", { ascending: false }).limit(20),
  ]);
  const seen = new Set<string>();
  return [...(byRef.data ?? []), ...(byDoc.data ?? [])]
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .map((r) => ({
      ...toLoad(r as LoadRow),
      clientId: r.client_id as string,
      client: name(r.client, "name"),
      status: r.status as string,
      isEmptyReturn: r.is_empty_return as boolean,
    }));
}

/** One of a customer's loads by its id, for the load card on the statement. */
export async function loadClientLoad(clientId: string, tripId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("trips")
    .select(`${LOAD_SELECT}, status, is_empty_return, client_id, entry_source, driver:drivers(full_name), invoice:invoices!trips_invoice_id_fkey(invoice_no, invoice_date, due_date)`)
    .eq("id", tripId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (!data) return null;
  const inv = data.invoice as { invoice_no: number; invoice_date: string; due_date: string } | null;
  return {
    ...toLoad(data as LoadRow),
    status: data.status,
    isEmptyReturn: data.is_empty_return,
    entrySource: data.entry_source,
    driver: (data.driver as { full_name: string } | null)?.full_name ?? null,
    invoiceNo: inv?.invoice_no ?? null,
    invoiceDate: inv?.invoice_date ?? null,
  };
}
