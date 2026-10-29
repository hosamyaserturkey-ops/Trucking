import { parseMoney, toLatinDigits } from "@/lib/money";

// Pure helpers for opening balances (الأرصدة الافتتاحية): the balances, driver
// advances and cheques on the day the company starts using the system.
// Amounts are JOD fils. Messages are Arabic.

type Get = (name: string) => string | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Accounts whose balances come from their own sections, never as plain account balances. */
export const CONTROL_ACCOUNTS = ["1103", "1104", "1105", "2101", "2102"];

export type OpeningKind = "account" | "client" | "supplier";

export type OpeningAmount = { debit_minor: number; credit_minor: number };

/** An amount and its side: "debit" (عليه / مدين) or "credit" (له / دائن). */
export function openingAmount(amountText: string, side: string): { ok: true; values: OpeningAmount } | { ok: false; error: string } {
  const amount = parseMoney(toLatinDigits(amountText.trim()), "JOD");
  if (amount === null || amount <= 0n) return { ok: false, error: "أدخل الرصيد (أكبر من صفر)" };
  if (side !== "debit" && side !== "credit") return { ok: false, error: "اختر جهة الرصيد" };
  const n = Number(amount);
  return { ok: true, values: side === "debit" ? { debit_minor: n, credit_minor: 0 } : { debit_minor: 0, credit_minor: n } };
}

/**
 * A signed balance from a spreadsheet cell: positive is the usual side for
 * that party (a customer owes us, we owe a supplier), negative the other.
 * Empty or zero means no opening balance.
 */
export function signedOpening(text: string, usual: "debit" | "credit"): { ok: true; values: OpeningAmount | null } | { ok: false; error: string } {
  const t = toLatinDigits(text.trim()).replace(/[−–]/g, "-");
  if (!t) return { ok: true, values: null };
  const negative = t.startsWith("-") || (t.startsWith("(") && t.endsWith(")"));
  const amount = parseMoney(t.replace(/^[-(]|\)$/g, ""), "JOD");
  if (amount === null) return { ok: false, error: "الرصيد الافتتاحي غير صحيح" };
  if (amount === 0n) return { ok: true, values: null };
  const side = negative ? (usual === "debit" ? "credit" : "debit") : usual;
  const n = Number(amount);
  return { ok: true, values: side === "debit" ? { debit_minor: n, credit_minor: 0 } : { debit_minor: 0, credit_minor: n } };
}

/** One balance line from the opening balances page. */
export function parseOpeningBalance(
  kind: OpeningKind,
  get: Get,
): { ok: true; values: { target_id: string; notes: string | null } & OpeningAmount } | { ok: false; error: string } {
  const target = (get("target_id") ?? "").trim();
  if (!UUID.test(target)) return { ok: false, error: kind === "account" ? "اختر الحساب" : kind === "client" ? "اختر الزبون" : "اختر المورد" };
  const amount = openingAmount(get("amount") ?? "", (get("side") ?? "").trim());
  if (!amount.ok) return amount;
  const notes = (get("notes") ?? "").trim();
  if (notes.length > 200) return { ok: false, error: "الملاحظات طويلة جداً" };
  return { ok: true, values: { target_id: target, notes: notes || null, ...amount.values } };
}

/** An advance a driver still holds on the opening date. */
export function parseOpeningAdvance(get: Get): { ok: true; values: { driver_id: string; amount_minor: number } } | { ok: false; error: string } {
  const driver = (get("driver_id") ?? "").trim();
  if (!UUID.test(driver)) return { ok: false, error: "اختر السائق" };
  const amount = parseMoney(toLatinDigits((get("amount") ?? "").trim()), "JOD");
  if (amount === null || amount <= 0n) return { ok: false, error: "أدخل مبلغ العهدة" };
  return { ok: true, values: { driver_id: driver, amount_minor: Number(amount) } };
}

export type OpeningCheque = {
  party_id: string;
  amount_minor: number;
  cheque_no: string;
  cheque_bank: string | null;
  cheque_due_date: string;
};

/** A customer cheque in hand, or our cheque not yet paid, on the opening date. */
export function parseOpeningCheque(get: Get): { ok: true; values: OpeningCheque } | { ok: false; error: string } {
  const text = (name: string) => toLatinDigits((get(name) ?? "").trim());
  const party = text("party_id");
  if (!UUID.test(party)) return { ok: false, error: "اختر صاحب الشيك" };
  const amount = parseMoney(text("amount"), "JOD");
  if (amount === null || amount <= 0n) return { ok: false, error: "أدخل مبلغ الشيك" };
  const cheque_no = text("cheque_no");
  if (!cheque_no) return { ok: false, error: "أدخل رقم الشيك" };
  if (cheque_no.length > 30) return { ok: false, error: "رقم الشيك طويل جداً" };
  const cheque_bank = (get("cheque_bank") ?? "").trim() || null;
  if (cheque_bank && cheque_bank.length > 60) return { ok: false, error: "اسم البنك طويل جداً" };
  const cheque_due_date = text("cheque_due_date");
  if (!ISO_DATE.test(cheque_due_date)) return { ok: false, error: "أدخل تاريخ استحقاق الشيك" };
  return { ok: true, values: { party_id: party, amount_minor: Number(amount), cheque_no, cheque_bank, cheque_due_date } };
}

/** The opening date: any valid date, not in the far future. */
export function parseOpeningDate(text: string, today: string): { ok: true; date: string } | { ok: false; error: string } {
  const d = toLatinDigits(text.trim());
  if (!ISO_DATE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) return { ok: false, error: "أدخل تاريخ بدء العمل" };
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) + 366 * 86400000).toISOString().slice(0, 10);
  if (d > limit) return { ok: false, error: "تاريخ بدء العمل بعيد جداً" };
  return { ok: true, date: d };
}
