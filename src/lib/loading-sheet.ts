import { parseMoney } from "@/lib/money";

// One line of the daily loading sheet (كشف التحميل اليومي). It is saved as a
// finished trip with entry_source "sheet": no start/finish steps and no
// odometer readings. The database gives it the customer reference.

export type LoadValues = {
  entry_source: "sheet";
  status: "completed";
  start_date: string;
  truck_id: string;
  driver_id: string | null;
  client_id: string;
  from_location_id: string;
  to_location_id: string;
  cargo_description: string | null;
  cargo_weight_tons: number | null;
  currency: string;
  freight_minor: number;
  fx_rate: number;
  client_doc_no: string | null;
  notes: string | null;
};

export type LoadParse = { ok: true; values: LoadValues } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a loading sheet line (new or edit). Messages are in Arabic for the user. */
export function parseLoadForm(get: (name: string) => string | null, today: string): LoadParse {
  const text = (name: string) => (get(name) ?? "").trim();

  const start_date = text("load_date");
  if (!ISO_DATE.test(start_date)) return { ok: false, error: "التاريخ غير صحيح" };
  if (start_date > today) return { ok: false, error: "لا يمكن تسجيل نقلة بتاريخ لاحق" };

  const truck_id = text("truck_id");
  if (!UUID.test(truck_id)) return { ok: false, error: "اختر الشاحنة" };
  const driver_id = text("driver_id") || null;
  if (driver_id && !UUID.test(driver_id)) return { ok: false, error: "سائق غير صحيح" };

  const client_id = text("client_id");
  if (!UUID.test(client_id)) return { ok: false, error: "اختر الزبون" };

  const from_location_id = text("from_location_id");
  const to_location_id = text("to_location_id");
  if (!UUID.test(from_location_id) || !UUID.test(to_location_id)) return { ok: false, error: "اختر مكان التحميل ومكان التنزيل" };
  if (from_location_id === to_location_id) return { ok: false, error: "مكان التحميل والتنزيل متطابقان" };

  let cargo_weight_tons: number | null = null;
  if (text("cargo_weight_tons") !== "") {
    const w = text("cargo_weight_tons");
    if (!/^\d+(\.\d{1,2})?$/.test(w) || Number(w) > 999) return { ok: false, error: "الوزن غير صحيح" };
    cargo_weight_tons = Number(w);
  }

  const currency = text("currency") || "JOD";
  if (currency !== "JOD" && currency !== "USD") return { ok: false, error: "عملة غير مدعومة" };
  const freight = parseMoney(text("freight"), currency);
  if (freight === null || freight <= 0n) return { ok: false, error: "أدخل الأجرة" };

  let fx_rate = 1;
  if (currency !== "JOD") {
    const rate = text("fx_rate");
    if (!/^\d+(\.\d{1,8})?$/.test(rate) || Number(rate) <= 0) return { ok: false, error: "سعر الصرف غير صحيح" };
    fx_rate = Number(rate);
  }

  const client_doc_no = text("client_doc_no") || null;
  if (client_doc_no && client_doc_no.length > 60) return { ok: false, error: "رقم مستند الزبون طويل جداً" };

  return {
    ok: true,
    values: {
      entry_source: "sheet",
      status: "completed",
      start_date,
      truck_id,
      driver_id,
      client_id,
      from_location_id,
      to_location_id,
      cargo_description: text("cargo_description") || null,
      cargo_weight_tons,
      currency,
      freight_minor: Number(freight),
      fx_rate,
      client_doc_no,
      notes: text("notes") || null,
    },
  };
}

/** Totals shown under the sheet: loads, tons and freight in JOD (minor units). */
export function sheetTotals(rows: { cargo_weight_tons: number | null; freight_base_minor: number }[]) {
  let tons = 0;
  let freight = 0;
  for (const r of rows) {
    tons += r.cargo_weight_tons ?? 0;
    freight += r.freight_base_minor;
  }
  return { loads: rows.length, tons: Math.round(tons * 100) / 100, freightBaseMinor: freight };
}
