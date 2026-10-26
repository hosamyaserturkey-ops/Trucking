import { parseMoney, toLatinDigits } from "@/lib/money";

// Office expense form (tires, tolls, fines, operating costs, overhead).
// Pure and unit tested; messages are Arabic.

type Get = (name: string) => string | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const OFFICE_EXPENSE_PAYMENTS = ["cash", "bank", "check", "credit", "driver_advance"] as const;

export type OfficeExpenseValues = {
  cost_scope: "truck" | "overhead";
  truck_id: string | null;
  trip_id: string | null;
  driver_id: string | null;
  category_id: string;
  supplier_id: string | null;
  description: string;
  expense_date: string;
  currency: "JOD" | "USD";
  amount_minor: number;
  fx_rate: number;
  payment_method: string;
  reference_no: string | null;
  receipt_upload: string | null;
};

export function parseOfficeExpense(
  get: Get,
  opts: { userId: string; today: string; allowedCategoryIds: string[] },
): { ok: true; values: OfficeExpenseValues } | { ok: false; error: string } {
  const text = (name: string) => toLatinDigits((get(name) ?? "").trim());
  const id = (name: string) => {
    const v = text(name);
    return v ? (UUID.test(v) ? v : undefined) : null;
  };

  const cost_scope = text("cost_scope") || "truck";
  if (cost_scope !== "truck" && cost_scope !== "overhead") return { ok: false, error: "نوع التحميل غير صحيح" };

  let truck_id: string | null = null;
  let trip_id: string | null = null;
  let driver_id: string | null = null;
  if (cost_scope === "truck") {
    const t = id("truck_id");
    if (!t) return { ok: false, error: "اختر الشاحنة أو اجعل المصروف عاماً" };
    truck_id = t;
    const trip = id("trip_id");
    const driver = id("driver_id");
    if (trip === undefined) return { ok: false, error: "الرحلة غير صحيحة" };
    if (driver === undefined) return { ok: false, error: "السائق غير صحيح" };
    trip_id = trip;
    driver_id = driver;
  }

  const category_id = text("category_id");
  if (!opts.allowedCategoryIds.includes(category_id)) return { ok: false, error: "اختر نوع المصروف" };
  const supplier = id("supplier_id");
  if (supplier === undefined) return { ok: false, error: "المورد غير صحيح" };

  const description = (get("description") ?? "").trim();
  if (!description) return { ok: false, error: "اكتب بيان المصروف" };
  if (description.length > 300) return { ok: false, error: "البيان طويل جداً" };

  const expense_date = text("expense_date") || opts.today;
  if (!ISO_DATE.test(expense_date)) return { ok: false, error: "التاريخ غير صحيح" };
  if (expense_date > opts.today) return { ok: false, error: "لا يمكن تسجيل مصروف بتاريخ لاحق" };

  const currency = text("currency") || "JOD";
  if (currency !== "JOD" && currency !== "USD") return { ok: false, error: "عملة غير مدعومة" };
  const amount = parseMoney(text("amount"), currency);
  if (amount === null || amount <= 0n) return { ok: false, error: "أدخل المبلغ" };
  let fx_rate = 1;
  if (currency !== "JOD") {
    const rate = text("fx_rate");
    if (!/^\d+(\.\d{1,8})?$/.test(rate) || Number(rate) <= 0) return { ok: false, error: "سعر الصرف غير صحيح" };
    fx_rate = Number(rate);
  }

  const payment_method = text("payment_method") || "cash";
  if (!(OFFICE_EXPENSE_PAYMENTS as readonly string[]).includes(payment_method)) return { ok: false, error: "طريقة الدفع غير صحيحة" };
  if (payment_method === "driver_advance" && !driver_id) return { ok: false, error: "اختر السائق الذي دفع من العهدة" };

  const reference_no = text("reference_no");
  if (reference_no.length > 60) return { ok: false, error: "رقم المرجع طويل جداً" };

  const receipt = text("receipt_upload");
  if (receipt && (!receipt.startsWith(`tmp/receipts/${opts.userId}/`) || receipt.includes(".."))) {
    return { ok: false, error: "ملف الإيصال غير صالح" };
  }

  return {
    ok: true,
    values: {
      cost_scope,
      truck_id,
      trip_id,
      driver_id,
      category_id,
      supplier_id: supplier,
      description,
      expense_date,
      currency,
      amount_minor: Number(amount),
      fx_rate,
      payment_method,
      reference_no: reference_no || null,
      receipt_upload: receipt || null,
    },
  };
}
