import { parseMoney } from "@/lib/money";

export type TripValues = {
  truck_id: string;
  driver_id: string | null;
  client_id: string | null;
  from_location_id: string;
  to_location_id: string;
  start_date: string;
  status: "planned" | "in_progress";
  start_odometer: number | null;
  cargo_description: string | null;
  cargo_weight_tons: number | null;
  is_empty_return: boolean;
  currency: string;
  freight_minor: number;
  fx_rate: number;
  notes: string | null;
};

export type TripParse = { ok: true; values: TripValues } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate the trip form (create and edit). Messages are in Arabic for the user. */
export function parseTripForm(get: (name: string) => string | null): TripParse {
  const text = (name: string) => (get(name) ?? "").trim();
  const optionalId = (name: string) => (text(name) === "" ? null : text(name));

  const truck_id = text("truck_id");
  if (!UUID.test(truck_id)) return { ok: false, error: "اختر الشاحنة" };
  const driver_id = optionalId("driver_id");
  if (driver_id && !UUID.test(driver_id)) return { ok: false, error: "سائق غير صحيح" };

  const from_location_id = text("from_location_id");
  const to_location_id = text("to_location_id");
  if (!UUID.test(from_location_id) || !UUID.test(to_location_id)) return { ok: false, error: "اختر نقطة الانطلاق والوجهة" };
  if (from_location_id === to_location_id) return { ok: false, error: "نقطة الانطلاق والوجهة متطابقتان" };

  const start_date = text("start_date");
  if (!ISO_DATE.test(start_date)) return { ok: false, error: "تاريخ البدء غير صحيح" };

  const status = text("status") === "in_progress" ? "in_progress" : "planned";
  let start_odometer: number | null = null;
  if (text("start_odometer") !== "") {
    if (!/^\d+$/.test(text("start_odometer"))) return { ok: false, error: "قراءة العداد يجب أن تكون رقماً صحيحاً" };
    start_odometer = Number(text("start_odometer"));
  }
  if (status === "in_progress" && start_odometer === null) {
    return { ok: false, error: "أدخل قراءة العداد لبدء الرحلة الآن" };
  }

  const is_empty_return = get("is_empty_return") === "on" || get("is_empty_return") === "true";
  const client_id = is_empty_return ? null : optionalId("client_id");
  if (client_id && !UUID.test(client_id)) return { ok: false, error: "عميل غير صحيح" };
  if (!is_empty_return && !client_id) return { ok: false, error: "اختر العميل، أو علّم الرحلة كعودة فارغة" };

  const currency = text("currency") || "JOD";
  if (currency !== "JOD" && currency !== "USD") return { ok: false, error: "عملة غير مدعومة" };

  let freight_minor = 0;
  if (!is_empty_return) {
    const parsed = parseMoney(text("freight"), currency);
    if (parsed === null || parsed <= 0n) return { ok: false, error: "أدخل أجرة النقل" };
    freight_minor = Number(parsed);
  }

  let fx_rate = 1;
  if (currency !== "JOD") {
    const rate = text("fx_rate");
    if (!/^\d+(\.\d{1,8})?$/.test(rate) || Number(rate) <= 0) return { ok: false, error: "سعر الصرف غير صحيح" };
    fx_rate = Number(rate);
  }

  let cargo_weight_tons: number | null = null;
  if (text("cargo_weight_tons") !== "") {
    if (!/^\d+(\.\d{1,2})?$/.test(text("cargo_weight_tons"))) return { ok: false, error: "الوزن غير صحيح" };
    cargo_weight_tons = Number(text("cargo_weight_tons"));
  }

  return {
    ok: true,
    values: {
      truck_id,
      driver_id,
      client_id,
      from_location_id,
      to_location_id,
      start_date,
      status,
      start_odometer,
      cargo_description: is_empty_return ? "عودة فارغة" : text("cargo_description") || null,
      cargo_weight_tons: is_empty_return ? null : cargo_weight_tons,
      is_empty_return,
      currency,
      freight_minor,
      fx_rate,
      notes: text("notes") || null,
    },
  };
}

/** Odometer reading for starting or finishing a trip. */
export function parseOdometer(raw: string | null, atLeast: number | null): { ok: true; value: number } | { ok: false; error: string } {
  const text = (raw ?? "").trim();
  if (!/^\d+$/.test(text)) return { ok: false, error: "أدخل قراءة العداد" };
  const value = Number(text);
  if (atLeast !== null && value < atLeast) {
    return { ok: false, error: `القراءة أقل من ${atLeast.toLocaleString("en-US")} كم` };
  }
  return { ok: true, value };
}
