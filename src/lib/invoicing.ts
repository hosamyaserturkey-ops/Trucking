import { parseMoney, toLatinDigits } from "@/lib/money";
import { addDays, todayIso } from "@/lib/date-range";

// Pure helpers for customer invoices, receipts and cheques. Amounts are JOD
// fils. Messages are Arabic.

type Get = (name: string) => string | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const RECEIPT_METHODS = ["cash", "bank", "cheque", "discount"] as const;
export type ReceiptMethod = (typeof RECEIPT_METHODS)[number];
export const CHEQUE_STATUSES = ["in_hand", "deposited", "cleared", "bounced"] as const;

/** One line's sales tax, rounded to the fils as create_invoice() does (line amounts are positive). */
export function lineVat(amountMinor: number, vatRatePct: number): number {
  return Math.round((amountMinor * vatRatePct) / 100);
}

/**
 * Subtotal, tax and total the way create_invoice() computes them: the tax is
 * worked out line by line and summed, as JoFotara checks it.
 */
export function invoiceTotals(amounts: number[], vatRatePct: number) {
  const subtotal = amounts.reduce((s, a) => s + a, 0);
  const vat = amounts.reduce((s, a) => s + lineVat(a, vatRatePct), 0);
  return { subtotal, vat, total: subtotal + vat };
}

/** The period a new invoice covers: last month by default, or ?from=&to=. */
export function draftPeriod(sp: { from?: string; to?: string }, today: string = todayIso()) {
  if (sp.from && sp.to && ISO_DATE.test(sp.from) && ISO_DATE.test(sp.to)) {
    return sp.from <= sp.to ? { from: sp.from, to: sp.to } : { from: sp.to, to: sp.from };
  }
  const firstThisMonth = `${today.slice(0, 8)}01`;
  const lastPrev = addDays(firstThisMonth, -1);
  return { from: `${lastPrev.slice(0, 8)}01`, to: lastPrev };
}

export type ReceiptValues = {
  client_id: string;
  received_on: string;
  method: ReceiptMethod;
  amount_minor: number;
  reference_no: string | null;
  cheque_no: string | null;
  cheque_bank: string | null;
  cheque_due_date: string | null;
  cheque_status: "in_hand" | null;
  notes: string | null;
};

/** A payment from a customer: cash, bank transfer, cheque (in hand) or a discount. */
export function parseReceipt(get: Get, opts: { today: string }): { ok: true; values: ReceiptValues } | { ok: false; error: string } {
  const text = (name: string) => toLatinDigits((get(name) ?? "").trim());
  const client_id = text("client_id");
  if (!UUID.test(client_id)) return { ok: false, error: "اختر الزبون" };
  const received_on = text("received_on") || opts.today;
  if (!ISO_DATE.test(received_on) || received_on > opts.today) return { ok: false, error: "تاريخ القبض غير صحيح" };
  const method = text("method") as ReceiptMethod;
  if (!RECEIPT_METHODS.includes(method)) return { ok: false, error: "اختر طريقة القبض" };
  const amount = parseMoney(text("amount"), "JOD");
  if (amount === null || amount <= 0n) return { ok: false, error: "أدخل المبلغ" };
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
      client_id,
      received_on,
      method,
      amount_minor: Number(amount),
      reference_no,
      cheque_no,
      cheque_bank,
      cheque_due_date,
      cheque_status: method === "cheque" ? "in_hand" : null,
      notes: notes || null,
    },
  };
}

/** A cheque's new status and the day it happened (none while it is still in hand). */
export function parseChequeStatus(
  get: Get,
  opts: { receivedOn: string; today: string },
): { ok: true; values: { cheque_status: string; cheque_status_on: string | null } } | { ok: false; error: string } {
  const status = (get("cheque_status") ?? "").trim();
  if (!(CHEQUE_STATUSES as readonly string[]).includes(status)) return { ok: false, error: "حالة الشيك غير صحيحة" };
  if (status === "in_hand") return { ok: true, values: { cheque_status: status, cheque_status_on: null } };
  const on = toLatinDigits((get("status_on") ?? "").trim()) || opts.today;
  if (!ISO_DATE.test(on) || on > opts.today) return { ok: false, error: "التاريخ غير صحيح" };
  if (on < opts.receivedOn) return { ok: false, error: "التاريخ قبل تاريخ استلام الشيك" };
  return { ok: true, values: { cheque_status: status, cheque_status_on: on } };
}

// ---------------------------------------------------------------------------
// Amount in words (المبلغ كتابةً), as printed on invoices and receipts.
// ---------------------------------------------------------------------------
const ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
const TEENS = ["عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  let rest = "";
  if (r > 0 && r < 10) rest = ONES[r];
  else if (r >= 10 && r < 20) rest = TEENS[r - 10];
  else if (r >= 20) rest = r % 10 ? `${ONES[r % 10]} و${TENS[Math.floor(r / 10)]}` : TENS[Math.floor(r / 10)];
  return [HUNDREDS[h], rest].filter(Boolean).join(" و");
}

/** 1 → ألف, 2 → ألفان, 3–10 → ثلاثة آلاف, 11+ → أحد عشر ألف. */
function scaled(n: number, one: string, two: string, few: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${below1000(n)} ${few}`;
  return `${below1000(n)} ${one}`;
}

/** A whole number in Arabic words, up to 999,999,999. */
export function numberInWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999) throw new Error(`Out of range: ${n}`);
  if (n === 0) return "صفر";
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  return [
    millions ? scaled(millions, "مليون", "مليونان", "ملايين") : "",
    thousands ? scaled(thousands, "ألف", "ألفان", "آلاف") : "",
    rest ? below1000(rest) : "",
  ]
    .filter(Boolean)
    .join(" و");
}

/** "فقط ألف ومائتان دينار أردني وخمسمائة فلس لا غير". */
export function amountInWords(minor: number): string {
  const dinars = Math.floor(minor / 1000);
  const fils = minor % 1000;
  const parts: string[] = [];
  if (dinars) parts.push(`${numberInWords(dinars)} دينار أردني`);
  if (fils) parts.push(`${numberInWords(fils)} فلس`);
  if (parts.length === 0) parts.push("صفر دينار أردني");
  return `فقط ${parts.join(" و")} لا غير`;
}
