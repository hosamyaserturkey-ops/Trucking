import { parseMoney } from "@/lib/money";

// Pure helpers for expense review, driver advances and settlements.
// Messages are in Arabic for the user.

type Get = (name: string) => string | null;
type Result<T> = { ok: true; values: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseRate(currency: string, raw: string): number | null {
  if (currency === "JOD") return 1;
  if (!/^\d+(\.\d{1,8})?$/.test(raw) || Number(raw) <= 0) return null;
  return Number(raw);
}

/** What the reviewer may correct before approving: category, amount and rate. */
export function parseApproval(
  get: Get,
  opts: { currency: string; allowedCategoryIds: string[] },
): Result<{ category_id: string; amount_minor: number; fx_rate: number }> {
  const text = (name: string) => (get(name) ?? "").trim();
  const category_id = text("category_id");
  if (!opts.allowedCategoryIds.includes(category_id)) return { ok: false, error: "اختر نوع المصروف" };
  const amount = parseMoney(text("amount"), opts.currency);
  if (amount === null || amount <= 0n) return { ok: false, error: "المبلغ غير صحيح" };
  const fx_rate = parseRate(opts.currency, text("fx_rate"));
  if (fx_rate === null) return { ok: false, error: "سعر الصرف غير صحيح" };
  return { ok: true, values: { category_id, amount_minor: Number(amount), fx_rate } };
}

export function parseRejection(get: Get): Result<{ rejection_reason: string }> {
  const reason = (get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: "اكتب سبب الرفض ليعرفه السائق" };
  if (reason.length > 500) return { ok: false, error: "سبب الرفض طويل جداً" };
  return { ok: true, values: { rejection_reason: reason } };
}

export type AdvanceValues = {
  driver_id: string;
  trip_id: string | null;
  issued_on: string;
  currency: string;
  amount_minor: number;
  fx_rate: number;
  method: "cash" | "bank";
  notes: string | null;
};

/** Cash or bank advance handed to a driver. */
export function parseAdvance(get: Get, opts: { today: string }): Result<AdvanceValues> {
  const text = (name: string) => (get(name) ?? "").trim();
  const driver_id = text("driver_id");
  if (!UUID.test(driver_id)) return { ok: false, error: "اختر السائق" };
  const trip_id = text("trip_id") || null;
  if (trip_id && !UUID.test(trip_id)) return { ok: false, error: "الرحلة غير صحيحة" };
  const issued_on = text("issued_on") || opts.today;
  if (!ISO_DATE.test(issued_on)) return { ok: false, error: "التاريخ غير صحيح" };
  if (issued_on > opts.today) return { ok: false, error: "لا يمكن تسجيل عهدة بتاريخ لاحق" };
  const currency = text("currency") || "JOD";
  if (currency !== "JOD" && currency !== "USD") return { ok: false, error: "عملة غير مدعومة" };
  const amount = parseMoney(text("amount"), currency);
  if (amount === null || amount <= 0n) return { ok: false, error: "أدخل المبلغ" };
  const fx_rate = parseRate(currency, text("fx_rate"));
  if (fx_rate === null) return { ok: false, error: "سعر الصرف غير صحيح" };
  const method = text("method") || "cash";
  if (method !== "cash" && method !== "bank") return { ok: false, error: "طريقة الصرف غير صحيحة" };
  return {
    ok: true,
    values: { driver_id, trip_id, issued_on, currency, amount_minor: Number(amount), fx_rate, method, notes: text("notes") || null },
  };
}

export type LedgerInput = {
  id: string;
  kind: "advance" | "expense";
  date: string;
  /** Always positive; the kind decides the sign. */
  base_minor: number;
};

export type LedgerRow<T extends LedgerInput> = T & { signed_minor: number; balance_minor: number };

/**
 * Open (unsettled) movements in date order with a running balance.
 * Advances raise what the driver holds; driver-paid expenses lower it.
 * Positive balance: the driver owes the company. Negative: the company owes the driver.
 */
export function openLedger<T extends LedgerInput>(items: T[]): LedgerRow<T>[] {
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === "advance" ? -1 : 1));
  let balance = 0;
  return sorted.map((item) => {
    const signed_minor = item.kind === "advance" ? item.base_minor : -item.base_minor;
    balance += signed_minor;
    return { ...item, signed_minor, balance_minor: balance };
  });
}

/** What settle_driver_advance will close for a given date (same rule as the database). */
export function settlementPreview(items: LedgerInput[], onDate: string) {
  const included = items.filter((i) => i.date <= onDate);
  const advances = included.filter((i) => i.kind === "advance").reduce((s, i) => s + i.base_minor, 0);
  const expenses = included.filter((i) => i.kind === "expense").reduce((s, i) => s + i.base_minor, 0);
  return { count: included.length, advances, expenses, difference: advances - expenses };
}
