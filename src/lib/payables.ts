import { parseMoney, toLatinDigits } from "@/lib/money";
import { parseDocNumbers } from "@/lib/doc-numbers";

// Pure helpers for payments to suppliers and the cheques we issue. Amounts
// are JOD fils. Messages are Arabic.

type Get = (name: string) => string | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const PAYMENT_METHODS = ["cash", "bank", "cheque", "discount"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const ISSUED_CHEQUE_STATUSES = ["issued", "cleared", "bounced"] as const;

export type SupplierPaymentValues = {
  supplier_id: string;
  paid_on: string;
  method: PaymentMethod;
  amount_minor: number;
  voucher_no: string | null;
  reference_no: string | null;
  cheque_no: string | null;
  cheque_bank: string | null;
  cheque_due_date: string | null;
  cheque_status: "issued" | null;
  notes: string | null;
};

/** A payment to a supplier: cash, bank transfer, a cheque we issue, or a discount he gives us. */
export function parseSupplierPayment(
  get: Get,
  opts: { today: string },
): { ok: true; values: SupplierPaymentValues } | { ok: false; error: string } {
  const text = (name: string) => toLatinDigits((get(name) ?? "").trim());
  const supplier_id = text("supplier_id");
  if (!UUID.test(supplier_id)) return { ok: false, error: "اختر المورد" };
  const paid_on = text("paid_on") || opts.today;
  if (!ISO_DATE.test(paid_on) || paid_on > opts.today) return { ok: false, error: "تاريخ الدفع غير صحيح" };
  const method = text("method") as PaymentMethod;
  if (!PAYMENT_METHODS.includes(method)) return { ok: false, error: "اختر طريقة الدفع" };
  const amount = parseMoney(text("amount"), "JOD");
  if (amount === null || amount <= 0n) return { ok: false, error: "أدخل المبلغ" };
  const docs = parseDocNumbers(text, ["voucher_no"] as const);
  if (!docs.ok) return docs;
  const notes = (get("notes") ?? "").trim();
  if (notes.length > 500) return { ok: false, error: "الملاحظات طويلة جداً" };

  let reference_no: string | null = null;
  let cheque_no: string | null = null;
  let cheque_bank: string | null = null;
  let cheque_due_date: string | null = null;
  if (method === "bank") {
    reference_no = text("reference_no") || null;
    if (reference_no && reference_no.length > 60) return { ok: false, error: "رقم الحوالة طويل جداً" };
  }
  if (method === "cheque") {
    cheque_no = text("cheque_no");
    if (!cheque_no) return { ok: false, error: "أدخل رقم الشيك" };
    if (cheque_no.length > 30) return { ok: false, error: "رقم الشيك طويل جداً" };
    cheque_bank = (get("cheque_bank") ?? "").trim() || null;
    if (cheque_bank && cheque_bank.length > 60) return { ok: false, error: "اسم البنك طويل جداً" };
    cheque_due_date = text("cheque_due_date");
    if (!ISO_DATE.test(cheque_due_date)) return { ok: false, error: "أدخل تاريخ استحقاق الشيك" };
  }

  return {
    ok: true,
    values: {
      supplier_id,
      paid_on,
      method,
      amount_minor: Number(amount),
      voucher_no: docs.values.voucher_no,
      reference_no,
      cheque_no,
      cheque_bank,
      cheque_due_date,
      cheque_status: method === "cheque" ? "issued" : null,
      notes: notes || null,
    },
  };
}

/** An issued cheque's new status and the day it happened (none while it still waits). */
export function parseIssuedChequeStatus(
  get: Get,
  opts: { paidOn: string; today: string },
): { ok: true; values: { cheque_status: string; cheque_status_on: string | null } } | { ok: false; error: string } {
  const status = (get("cheque_status") ?? "").trim();
  if (!(ISSUED_CHEQUE_STATUSES as readonly string[]).includes(status)) return { ok: false, error: "حالة الشيك غير صحيحة" };
  if (status === "issued") return { ok: true, values: { cheque_status: status, cheque_status_on: null } };
  const on = toLatinDigits((get("status_on") ?? "").trim()) || opts.today;
  if (!ISO_DATE.test(on) || on > opts.today) return { ok: false, error: "التاريخ غير صحيح" };
  if (on < opts.paidOn) return { ok: false, error: "التاريخ قبل تاريخ إصدار الشيك" };
  return { ok: true, values: { cheque_status: status, cheque_status_on: on } };
}
