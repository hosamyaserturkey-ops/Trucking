import { parseMoney, toLatinDigits } from "@/lib/money";
import { TIMEZONE } from "@/lib/date-range";

// Pure helpers for diesel fill-ups: form parsing (driver phone and office),
// price per liter, and the km/L a new fill-up implies. Messages are Arabic.

type Get = (name: string) => string | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Payment methods offered on the office form (no own tank: the company has none). */
export const OFFICE_FUEL_PAYMENTS = ["cash", "card", "credit", "driver_advance"] as const;
export const MAX_LITERS = 2000;

export type FillupValues = {
  truck_id: string | null; // office only; the driver's truck comes from the trip or his default truck
  driver_id: string | null; // office only
  trip_id: string | null;
  station_id: string | null;
  filled_at: string; // ISO timestamp (UTC)
  odometer: number;
  liters: number;
  is_full_tank: boolean;
  currency: "JOD" | "USD";
  amount_minor: number;
  fx_rate: number | null; // null: use the currency's default rate
  payment_method: string;
  notes: string | null;
  receipt_upload: string | null;
};

/** Minutes the zone is ahead of UTC at that moment (Asia/Amman: +180). */
function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"));
  return Math.round((wall - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** A wall-clock date and time in the company's timezone, as an ISO timestamp. */
export function zonedIso(date: string, time: string, timeZone = TIMEZONE): string {
  const guess = new Date(`${date}T${time}:00Z`);
  return new Date(guess.getTime() - zoneOffsetMinutes(guess, timeZone) * 60000).toISOString();
}

/** The current wall-clock time in the company's timezone, as HH:MM. */
export function nowTime(now: Date = new Date(), timeZone = TIMEZONE): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

/** Price per liter in minor units, rounded. */
export function pricePerLiter(amountMinor: number, liters: number): number | null {
  return liters > 0 ? Math.round(amountMinor / liters) : null;
}

type Fill = { odometer: number; liters: number; is_full_tank: boolean };

/**
 * km/L by the full-tank method for a new full fill-up: km since the truck's
 * previous full fill-up, over this fill's liters plus any partial fills since.
 * `history` is the truck's earlier approved fill-ups, newest first.
 */
export function impliedKmPerLiter(fill: Fill, history: Fill[]): number | null {
  if (!fill.is_full_tank) return null;
  let partial = 0;
  for (const h of history) {
    if (h.is_full_tank) {
      const km = fill.odometer - h.odometer;
      const liters = fill.liters + partial;
      return km > 0 && liters > 0 ? Math.round((km / liters) * 100) / 100 : null;
    }
    partial += h.liters;
  }
  return null;
}

/** Same rule as fuel_efficiency_v: below the baseline by more than the threshold. */
export function isAbnormal(kmPerLiter: number | null, baseline: number | null, thresholdPct: number): boolean {
  return kmPerLiter !== null && baseline !== null && kmPerLiter < baseline * (1 - thresholdPct / 100);
}

/**
 * Validate a fill-up form. mode "driver": payment is always from the advance
 * and truck/driver come from the server. mode "office": truck required, any
 * office payment method. `userId` scopes the receipt upload to the user's folder.
 */
export function parseFillup(
  get: Get,
  opts: { mode: "driver" | "office"; userId: string; now?: Date; requireReceipt?: boolean },
): { ok: true; values: FillupValues } | { ok: false; error: string } {
  const text = (name: string) => toLatinDigits((get(name) ?? "").trim());
  const optionalId = (name: string, label: string) => {
    const v = text(name);
    if (!v) return { ok: true as const, value: null };
    return UUID.test(v) ? { ok: true as const, value: v } : { ok: false as const, error: `${label} غير صحيح` };
  };

  let truck_id: string | null = null;
  let driver_id: string | null = null;
  if (opts.mode === "office") {
    truck_id = text("truck_id");
    if (!UUID.test(truck_id)) return { ok: false, error: "اختر الشاحنة" };
    const d = optionalId("driver_id", "السائق");
    if (!d.ok) return d;
    driver_id = d.value;
  }
  const trip = optionalId("trip_id", "الرحلة");
  if (!trip.ok) return trip;
  const station = optionalId("station_id", "المحطة");
  if (!station.ok) return station;

  const now = opts.now ?? new Date();
  const date = text("filled_on");
  const time = text("filled_time") || "12:00";
  if (!ISO_DATE.test(date) || !TIME.test(time)) return { ok: false, error: "أدخل تاريخ ووقت التعبئة" };
  const filled_at = zonedIso(date, time);
  if (new Date(filled_at).getTime() > now.getTime() + 10 * 60000) return { ok: false, error: "لا يمكن تسجيل تعبئة بوقت لاحق" };

  const odoText = text("odometer").replace(/[,\s]/g, "");
  if (!/^\d{1,8}$/.test(odoText)) return { ok: false, error: "أدخل قراءة العداد" };
  const odometer = Number(odoText);

  const litersText = text("liters").replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(litersText) || Number(litersText) <= 0) return { ok: false, error: "أدخل كمية اللترات" };
  const liters = Number(litersText);
  if (liters > MAX_LITERS) return { ok: false, error: "كمية اللترات غير منطقية" };

  const currency = text("currency") || "JOD";
  if (currency !== "JOD" && currency !== "USD") return { ok: false, error: "عملة غير مدعومة" };
  const amount = parseMoney(text("amount"), currency);
  if (amount === null || amount <= 0n) return { ok: false, error: "أدخل المبلغ" };

  let fx_rate: number | null = null;
  if (currency === "JOD") fx_rate = 1;
  else if (text("fx_rate")) {
    const rate = text("fx_rate");
    if (!/^\d+(\.\d{1,8})?$/.test(rate) || Number(rate) <= 0) return { ok: false, error: "سعر الصرف غير صحيح" };
    fx_rate = Number(rate);
  }

  let payment_method = "driver_advance";
  if (opts.mode === "office") {
    payment_method = text("payment_method") || "cash";
    if (!(OFFICE_FUEL_PAYMENTS as readonly string[]).includes(payment_method)) return { ok: false, error: "طريقة الدفع غير صحيحة" };
    if (payment_method === "driver_advance" && !driver_id) return { ok: false, error: "اختر السائق الذي دفع من العهدة" };
  }

  const receipt = text("receipt_upload");
  if (receipt && (!receipt.startsWith(`tmp/receipts/${opts.userId}/`) || receipt.includes(".."))) {
    return { ok: false, error: "ملف الإيصال غير صالح" };
  }
  if (opts.requireReceipt && !receipt) return { ok: false, error: "صوّر إيصال التعبئة" };

  const notes = (get("notes") ?? "").trim();
  if (notes.length > 500) return { ok: false, error: "الملاحظة طويلة جداً" };

  return {
    ok: true,
    values: {
      truck_id,
      driver_id,
      trip_id: trip.value,
      station_id: station.value,
      filled_at,
      odometer,
      liters,
      is_full_tank: get("is_full_tank") === "on" || get("is_full_tank") === "true",
      currency,
      amount_minor: Number(amount),
      fx_rate,
      payment_method,
      notes: notes || null,
      receipt_upload: receipt || null,
    },
  };
}

/** What the reviewer may correct before approving a fill-up. */
export function parseFuelApproval(
  get: Get,
  currency: string,
): { ok: true; values: { liters: number; amount_minor: number; odometer: number; is_full_tank: boolean; fx_rate?: number } } | { ok: false; error: string } {
  const text = (name: string) => toLatinDigits((get(name) ?? "").trim()).replace(/[,\s]/g, "");
  const litersText = text("liters");
  if (!/^\d+(\.\d{1,2})?$/.test(litersText) || Number(litersText) <= 0 || Number(litersText) > MAX_LITERS) {
    return { ok: false, error: "كمية اللترات غير صحيحة" };
  }
  const amount = parseMoney(text("amount"), currency);
  if (amount === null || amount <= 0n) return { ok: false, error: "المبلغ غير صحيح" };
  const odo = text("odometer");
  if (!/^\d{1,8}$/.test(odo)) return { ok: false, error: "قراءة العداد غير صحيحة" };
  const values: { liters: number; amount_minor: number; odometer: number; is_full_tank: boolean; fx_rate?: number } = {
    liters: Number(litersText),
    amount_minor: Number(amount),
    odometer: Number(odo),
    is_full_tank: get("is_full_tank") === "on",
  };
  if (currency !== "JOD") {
    const rate = text("fx_rate");
    if (!/^\d+(\.\d{1,8})?$/.test(rate) || Number(rate) <= 0) return { ok: false, error: "سعر الصرف غير صحيح" };
    values.fx_rate = Number(rate);
  }
  return { ok: true, values };
}

/**
 * Average km/L over several measured fill-ups, weighted by distance:
 * total km / total liters burnt (km ÷ km/L), not a plain average of ratios.
 */
export function weightedKmPerLiter(rows: { km: number | null; kmPerLiter: number | null }[]): number | null {
  let km = 0;
  let liters = 0;
  for (const r of rows) {
    if (!r.km || !r.kmPerLiter || r.km <= 0 || r.kmPerLiter <= 0) continue;
    km += r.km;
    liters += r.km / r.kmPerLiter;
  }
  return liters > 0 ? Math.round((km / liters) * 100) / 100 : null;
}
