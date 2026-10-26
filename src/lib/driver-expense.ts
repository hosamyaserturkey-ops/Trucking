import { parseMoney } from "@/lib/money";

/** Categories a driver may use from the phone. */
export const DRIVER_CATEGORY_CODES = ["tolls", "weighing_parking", "loading", "meals", "fines", "operating", "other"] as const;
export const DRIVER_PAYMENT_METHODS = ["driver_advance", "credit"] as const;

export type DriverExpenseValues = {
  trip_id: string;
  category_id: string;
  expense_date: string;
  currency: string;
  amount_minor: number;
  payment_method: (typeof DRIVER_PAYMENT_METHODS)[number];
  description: string | null;
  receipt_path: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a driver's expense form. `userId` scopes the receipt path: a driver
 * may only attach files from their own Storage folder.
 */
export function parseDriverExpense(
  get: (name: string) => string | null,
  opts: { userId: string; allowedCategoryIds: string[]; today: string },
): { ok: true; values: DriverExpenseValues } | { ok: false; error: string } {
  const text = (name: string) => (get(name) ?? "").trim();

  const trip_id = text("trip_id");
  if (!UUID.test(trip_id)) return { ok: false, error: "اختر الرحلة" };
  const category_id = text("category_id");
  if (!opts.allowedCategoryIds.includes(category_id)) return { ok: false, error: "اختر نوع المصروف" };

  const expense_date = text("expense_date") || opts.today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expense_date)) return { ok: false, error: "التاريخ غير صحيح" };
  if (expense_date > opts.today) return { ok: false, error: "لا يمكن تسجيل مصروف بتاريخ لاحق" };

  const currency = text("currency") || "JOD";
  if (currency !== "JOD" && currency !== "USD") return { ok: false, error: "عملة غير مدعومة" };
  const amount = parseMoney(text("amount"), currency);
  if (amount === null || amount <= 0n) return { ok: false, error: "أدخل المبلغ" };

  const method = text("payment_method") || "driver_advance";
  if (!(DRIVER_PAYMENT_METHODS as readonly string[]).includes(method)) return { ok: false, error: "طريقة دفع غير صحيحة" };

  const receipt = text("receipt_path");
  if (receipt && !receipt.startsWith(`${opts.userId}/`)) return { ok: false, error: "ملف الإيصال غير صالح" };

  return {
    ok: true,
    values: {
      trip_id,
      category_id,
      expense_date,
      currency,
      amount_minor: Number(amount),
      payment_method: method as DriverExpenseValues["payment_method"],
      description: text("description") || null,
      receipt_path: receipt || null,
    },
  };
}
