import { createClient } from "@/lib/supabase/server";
import { addDays, todayIso } from "@/lib/date-range";

export type SheetFilter = { from: string; to: string; truck: string; client: string };

export type SheetRow = {
  id: string;
  ref: string | null;
  date: string;
  truckCode: string;
  driver: string | null;
  client: string | null;
  from: string | null;
  to: string | null;
  cargo: string | null;
  tons: number | null;
  currency: string;
  freightMinor: number;
  freightBaseMinor: number;
  docNo: string | null;
  notes: string | null;
  /** Set once the load is on an invoice; it can't be edited or deleted then. */
  invoiceId: string | null;
  invoiceNo: number | null; // only finance roles can see invoices
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read the sheet's filters from the URL: one day (?date=) by default, or a
 * period (?from=&to=, both inclusive), optionally one truck and one customer.
 */
export function sheetFilter(sp: { date?: string; from?: string; to?: string; truck?: string; client?: string }): SheetFilter {
  const today = todayIso();
  let from = sp.date && ISO_DATE.test(sp.date) ? sp.date : today;
  let to = from;
  if (sp.from && sp.to && ISO_DATE.test(sp.from) && ISO_DATE.test(sp.to) && sp.from <= sp.to) {
    from = sp.from;
    to = sp.to;
  }
  return {
    from,
    to,
    truck: sp.truck && UUID.test(sp.truck) ? sp.truck : "",
    client: sp.client && UUID.test(sp.client) ? sp.client : "",
  };
}

/** Loading sheet lines for the filter, oldest first (the order they are written down). */
export async function loadSheetRows(f: SheetFilter): Promise<SheetRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("trips")
    .select(
      "id, client_ref, start_date, cargo_description, cargo_weight_tons, currency, freight_minor, freight_base_minor, client_doc_no, notes, invoice_id, invoice:invoices!trips_invoice_id_fkey(invoice_no), truck:trucks(code), driver:drivers(full_name), client:clients(name), from_loc:locations!trips_from_location_id_fkey(name), to_loc:locations!trips_to_location_id_fkey(name)",
    )
    .eq("entry_source", "sheet")
    .gte("start_date", f.from)
    .lt("start_date", addDays(f.to, 1))
    .order("start_date")
    .order("trip_no")
    .limit(1000);
  if (f.truck) query = query.eq("truck_id", f.truck);
  if (f.client) query = query.eq("client_id", f.client);
  const { data } = await query;
  return (data ?? []).map((r) => ({
    id: r.id,
    ref: r.client_ref,
    date: r.start_date,
    truckCode: (r.truck as { code: string } | null)?.code ?? "",
    driver: (r.driver as { full_name: string } | null)?.full_name ?? null,
    client: (r.client as { name: string } | null)?.name ?? null,
    from: (r.from_loc as { name: string } | null)?.name ?? null,
    to: (r.to_loc as { name: string } | null)?.name ?? null,
    cargo: r.cargo_description,
    tons: r.cargo_weight_tons,
    currency: r.currency,
    freightMinor: r.freight_minor,
    freightBaseMinor: r.freight_base_minor,
    docNo: r.client_doc_no,
    notes: r.notes,
    invoiceId: r.invoice_id,
    invoiceNo: (r.invoice as { invoice_no: number } | null)?.invoice_no ?? null,
  }));
}
