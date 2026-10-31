import { parseMoney, toLatinDigits } from "@/lib/money";
import { excelDate } from "@/lib/xlsx";

// Pure helpers for bank reconciliation (مطابقة كشف البنك): reading the bank's
// statement file (Excel or CSV, Arabic or English headers), and suggesting
// matches with the ledger. Amounts are JOD fils, + money into the account.

export type StatementLine = {
  txn_date: string;
  value_date: string | null;
  description: string;
  reference: string | null;
  amount_minor: number;
  balance_minor: number | null;
};

export const MAX_STATEMENT_LINES = 3000;

// ---------------------------------------------------------------------------
// Amounts and dates as banks write them
// ---------------------------------------------------------------------------

/**
 * "1,250.500", "(75.25)", "75.25-", "1250.5 CR", "١٬٢٥٠٫٥", "1.2345E3" → fils.
 * Null for an empty or unreadable cell. More than 3 decimals are rounded.
 */
export function parseBankAmount(raw: string | null | undefined): number | null {
  let t = toLatinDigits(String(raw ?? ""))
    .replace(/[ ‏‎\s]/g, "")
    .replace(/JOD|JD|د\.أ|دينار/gi, "");
  if (!t || t === "-") return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  if (/(DR|Dr|dr)$/.test(t)) {
    negative = true;
    t = t.slice(0, -2);
  } else if (/(CR|Cr|cr)$/.test(t)) {
    t = t.slice(0, -2);
  }
  if (t.endsWith("-")) {
    negative = !negative;
    t = t.slice(0, -1);
  }
  if (t.startsWith("-")) {
    negative = !negative;
    t = t.slice(1);
  } else if (t.startsWith("+")) {
    t = t.slice(1);
  }
  t = t.replace(/,/g, "");
  if (/^\d+(\.\d+)?e[+-]?\d+$/i.test(t)) t = Number(t).toFixed(3);
  const m = /^(\d+)(?:\.(\d*))?$/.exec(t);
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(4, "0");
  // Round half up on the fourth decimal.
  let minor = Number(m[1]) * 1000 + Number(frac.slice(0, 3));
  if (Number(frac[3]) >= 5) minor += 1;
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

/** A statement date: an Excel serial, or 31/12/2026, 2026-12-31, 31-12-2026, optionally followed by a time. */
export function parseBankDate(raw: string | null | undefined): string | null {
  const t = toLatinDigits(String(raw ?? "")).trim().split(/[ T]/)[0] ?? "";
  if (!t) return null;
  return excelDate(t);
}

// ---------------------------------------------------------------------------
// Statement files
// ---------------------------------------------------------------------------

/** Rows of a CSV file (comma, semicolon or tab; quotes allowed). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop();
  return rows;
}

/** Header text made comparable: lower case, Arabic letter forms unified, no punctuation. */
export function normalizeHeader(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

type Column = "date" | "value_date" | "description" | "reference" | "debit" | "credit" | "amount" | "balance";

// Checked in this order; a header takes the first kind it matches.
const HEADERS: [Column, string[]][] = [
  ["value_date", ["تاريخ القيمه", "تاريخ الاستحقاق", "value date", "valuedate"]],
  ["date", ["تاريخ الحركه", "تاريخ العمليه", "تاريخ القيد", "التاريخ", "تاريخ", "transaction date", "posting date", "booking date", "post date", "txn date", "date"]],
  ["balance", ["الرصيد", "رصيد", "balance", "running balance"]],
  ["debit", ["مدين", "سحب", "سحوبات", "مسحوبات", "المسحوب", "خصم", "debit", "debits", "withdrawal", "withdrawals", "dr"]],
  ["credit", ["دائن", "ايداع", "ايداعات", "المودع", "اضافه", "credit", "credits", "deposit", "deposits", "cr"]],
  ["amount", ["المبلغ", "مبلغ", "amount", "value"]],
  ["reference", ["رقم المرجع", "المرجع", "مرجع", "رقم الشيك", "رقم المستند", "reference", "ref", "cheque no", "check no", "cheque number", "document no", "doc no"]],
  ["description", ["البيان", "بيان", "الوصف", "التفاصيل", "تفاصيل", "شرح", "description", "details", "narrative", "narration", "particulars", "remarks", "transaction details"]],
];

function columnKind(header: string): Column | null {
  const h = normalizeHeader(header);
  if (!h) return null;
  for (const [kind, names] of HEADERS) {
    for (const n of names) {
      const words = h.split(" ");
      if (h === n || (n.length > 3 && h.includes(n)) || (n.length <= 3 && words.includes(n))) return kind;
    }
  }
  return null;
}

const OPENING_ROW = /رصيد (افتتاحي|سابق|اول المده|منقول)|opening balance|balance (brought )?forward|previous balance|b\/f/i;
const CLOSING_ROW = /رصيد (ختامي|اخر المده|نهائي)|closing balance|ending balance|balance carried forward|c\/f/i;

export type ParsedStatement = {
  lines: StatementLine[];
  columns: Partial<Record<Column, string>>;
  skipped: number;
  openingHint: number | null;
  closingHint: number | null;
  reversed: boolean;
};

/**
 * The movements of a bank statement file: finds the header row, reads dates
 * and amounts (debit/credit columns or one signed amount), skips opening and
 * closing balance rows (keeping them as hints), and puts the lines oldest first.
 */
export function parseStatementRows(rows: string[][]): { ok: true; value: ParsedStatement } | { ok: false; error: string } {
  let headerAt = -1;
  let map: Partial<Record<Column, number>> = {};
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const found: Partial<Record<Column, number>> = {};
    rows[i].forEach((cell, c) => {
      const k = columnKind(cell);
      if (k && found[k] === undefined) found[k] = c;
    });
    if (found.date !== undefined && (found.amount !== undefined || found.debit !== undefined || found.credit !== undefined)) {
      headerAt = i;
      map = found;
      break;
    }
  }
  if (headerAt < 0) {
    return { ok: false, error: "لم أجد صف العناوين: يحتاج الملف عمود «التاريخ» وعمود «المبلغ» أو عمودي «مدين» و«دائن»" };
  }
  const header = rows[headerAt];
  const columns: Partial<Record<Column, string>> = {};
  for (const [k, c] of Object.entries(map)) columns[k as Column] = header[c as number];

  const cell = (r: string[], k: Column) => (map[k] === undefined ? "" : (r[map[k] as number] ?? ""));
  let lines: StatementLine[] = [];
  let skipped = 0;
  let openingHint: number | null = null;
  let closingHint: number | null = null;
  for (const r of rows.slice(headerAt + 1)) {
    if (r.every((c) => !c)) continue;
    const text = r.join(" ");
    const date = parseBankDate(cell(r, "date"));
    const balance = parseBankAmount(cell(r, "balance"));
    if (OPENING_ROW.test(normalizeHeader(text)) || OPENING_ROW.test(text)) {
      if (balance !== null) openingHint = balance;
      continue;
    }
    if (CLOSING_ROW.test(normalizeHeader(text)) || CLOSING_ROW.test(text)) {
      if (balance !== null) closingHint = balance;
      continue;
    }
    let amount: number | null;
    if (map.debit !== undefined || map.credit !== undefined) {
      const dr = parseBankAmount(cell(r, "debit"));
      const cr = parseBankAmount(cell(r, "credit"));
      amount = dr === null && cr === null ? null : (cr ?? 0) - Math.abs(dr ?? 0);
      if (map.amount !== undefined && (amount === null || amount === 0)) amount = parseBankAmount(cell(r, "amount"));
    } else {
      amount = parseBankAmount(cell(r, "amount"));
    }
    if (!date || amount === null || amount === 0) {
      skipped++;
      continue;
    }
    const valueDate = parseBankDate(cell(r, "value_date"));
    lines.push({
      txn_date: date,
      value_date: valueDate,
      description: cell(r, "description").replace(/\s+/g, " ").trim().slice(0, 300),
      reference: toLatinDigits(cell(r, "reference")).trim().slice(0, 80) || null,
      amount_minor: amount,
      balance_minor: balance,
    });
  }
  if (lines.length === 0) return { ok: false, error: "لم أجد أي حركة بتاريخ ومبلغ في الملف" };
  if (lines.length > MAX_STATEMENT_LINES) return { ok: false, error: `الكشف أطول من ${MAX_STATEMENT_LINES} حركة؛ قسّمه على فترات أقصر` };

  // Newest first in the file: put it oldest first.
  const reversed = lines[0].txn_date > lines[lines.length - 1].txn_date;
  if (reversed) lines = lines.reverse();
  const first = lines[0];
  if (openingHint === null && first.balance_minor !== null) openingHint = first.balance_minor - first.amount_minor;
  const last = lines[lines.length - 1];
  if (closingHint === null && last.balance_minor !== null) closingHint = last.balance_minor;
  return { ok: true, value: { lines, columns, skipped, openingHint, closingHint, reversed } };
}

/** The template offered for download: one header row and one example movement. */
export const STATEMENT_TEMPLATE: (string | number)[][] = [
  ["التاريخ", "البيان", "المرجع", "مدين (سحب)", "دائن (إيداع)", "الرصيد"],
  ["2026-10-01", "مثال: إيداع شيك — احذف هذا الصف", "123456", "", 1500, 1500],
];

// ---------------------------------------------------------------------------
// The statement form (checked again on the server)
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type StatementValues = {
  account_id: string;
  period_from: string;
  period_to: string;
  opening_minor: number;
  lines: StatementLine[];
  source_name: string | null;
  notes: string | null;
};

/** The new statement as posted by the form: header fields plus the lines read in the browser (JSON). */
export function parseStatementForm(get: (name: string) => string | null, opts: { today: string }): { ok: true; values: StatementValues } | { ok: false; error: string } {
  const t = (n: string) => toLatinDigits((get(n) ?? "").trim());
  const account_id = t("account_id");
  if (!UUID.test(account_id)) return { ok: false, error: "اختر حساب البنك" };
  const period_from = t("period_from");
  const period_to = t("period_to");
  if (!ISO_DATE.test(period_from) || !ISO_DATE.test(period_to) || period_from > period_to) return { ok: false, error: "فترة الكشف غير صحيحة" };
  if (period_to > opts.today) return { ok: false, error: "نهاية فترة الكشف بعد اليوم" };
  const opening = parseMoney(t("opening"), "JOD");
  if (opening === null) return { ok: false, error: "أدخل رصيد أول المدة كما في كشف البنك" };
  let raw: unknown;
  try {
    raw = JSON.parse(get("lines_json") || "[]");
  } catch {
    return { ok: false, error: "سطور الكشف غير صحيحة؛ أعد اختيار الملف" };
  }
  if (!Array.isArray(raw)) return { ok: false, error: "سطور الكشف غير صحيحة؛ أعد اختيار الملف" };
  if (raw.length > MAX_STATEMENT_LINES) return { ok: false, error: `الكشف أطول من ${MAX_STATEMENT_LINES} حركة` };
  const lines: StatementLine[] = [];
  for (const [i, r] of raw.entries()) {
    const l = r as Partial<StatementLine>;
    const date = typeof l.txn_date === "string" && ISO_DATE.test(l.txn_date) ? l.txn_date : null;
    const amount = typeof l.amount_minor === "number" && Number.isSafeInteger(l.amount_minor) && l.amount_minor !== 0 ? l.amount_minor : null;
    if (!date || amount === null) return { ok: false, error: `الحركة رقم ${i + 1} بلا تاريخ أو مبلغ صحيح` };
    if (date < period_from || date > period_to) return { ok: false, error: `الحركة رقم ${i + 1} (${date}) خارج فترة الكشف` };
    const balance = typeof l.balance_minor === "number" && Number.isSafeInteger(l.balance_minor) ? l.balance_minor : null;
    lines.push({
      txn_date: date,
      value_date: typeof l.value_date === "string" && ISO_DATE.test(l.value_date) ? l.value_date : null,
      description: String(l.description ?? "").slice(0, 300),
      reference: l.reference ? String(l.reference).slice(0, 80) : null,
      amount_minor: amount,
      balance_minor: balance,
    });
  }
  const notes = (get("notes") ?? "").trim();
  if (notes.length > 500) return { ok: false, error: "الملاحظات طويلة جداً" };
  return {
    ok: true,
    values: {
      account_id,
      period_from,
      period_to,
      opening_minor: Number(opening),
      lines,
      source_name: (get("source_name") ?? "").trim().slice(0, 200) || null,
      notes: notes || null,
    },
  };
}

/** One movement typed by hand: in or out, date, amount, description, reference. */
export function parseManualLine(
  get: (name: string) => string | null,
  opts: { from: string; to: string },
): { ok: true; values: { txn_date: string; amount_minor: number; description: string; reference: string | null } } | { ok: false; error: string } {
  const t = (n: string) => toLatinDigits((get(n) ?? "").trim());
  const txn_date = t("txn_date");
  if (!ISO_DATE.test(txn_date) || txn_date < opts.from || txn_date > opts.to) return { ok: false, error: "تاريخ الحركة خارج فترة الكشف" };
  const amount = parseMoney(t("amount"), "JOD");
  if (amount === null || amount <= 0n) return { ok: false, error: "أدخل مبلغ الحركة" };
  const direction = t("direction");
  if (direction !== "in" && direction !== "out") return { ok: false, error: "اختر إيداعاً أو سحباً" };
  const description = (get("description") ?? "").replace(/\s+/g, " ").trim();
  if (description.length > 300) return { ok: false, error: "البيان طويل جداً" };
  const reference = t("reference") || null;
  if (reference && reference.length > 80) return { ok: false, error: "المرجع طويل جداً" };
  return { ok: true, values: { txn_date, amount_minor: direction === "in" ? Number(amount) : -Number(amount), description, reference } };
}

// ---------------------------------------------------------------------------
// Suggested matches
// ---------------------------------------------------------------------------

export type BankSide = { id: string; date: string; amount: number; text: string };
export type BookSide = { id: string; date: string; amount: number; refs: (string | number | null)[] };

function dayDiff(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;
}

/**
 * One-to-one matches with the same amount within `maxDays`: a bank line
 * whose text carries the book line's cheque, notice or voucher number comes
 * first, then the closest date. Each line is used once.
 */
export function suggestMatches(bank: BankSide[], book: BookSide[], { maxDays = 10 } = {}): { bank: string; book: string }[] {
  const digits = (s: string) => toLatinDigits(s).replace(/\s+/g, "");
  const candidates: { bank: string; book: string; miss: number; days: number; order: string }[] = [];
  for (const b of bank) {
    const text = digits(b.text);
    for (const k of book) {
      if (k.amount !== b.amount) continue;
      const days = dayDiff(b.date, k.date);
      if (days > maxDays) continue;
      const hit = k.refs.some((r) => {
        const ref = digits(String(r ?? ""));
        return ref.length >= 3 && text.includes(ref);
      });
      candidates.push({ bank: b.id, book: k.id, miss: hit ? 0 : 1, days, order: `${b.date}|${k.date}|${b.id}|${k.id}` });
    }
  }
  candidates.sort((x, y) => x.miss - y.miss || x.days - y.days || x.order.localeCompare(y.order));
  const usedBank = new Set<string>();
  const usedBook = new Set<string>();
  const out: { bank: string; book: string }[] = [];
  for (const c of candidates) {
    if (usedBank.has(c.bank) || usedBook.has(c.book)) continue;
    usedBank.add(c.bank);
    usedBook.add(c.book);
    out.push({ bank: c.bank, book: c.book });
  }
  return out;
}

/** The reconciliation as the screen shows it, from the database's figures. */
export function reconciliationLines(r: {
  bank_balance_minor: number;
  book_balance_minor: number;
  outstanding_in_minor: number;
  outstanding_out_minor: number;
  unrecorded_in_minor: number;
  unrecorded_out_minor: number;
}): { adjustedBank: number; adjustedBook: number; difference: number } {
  const adjustedBank = r.bank_balance_minor + r.outstanding_in_minor - r.outstanding_out_minor;
  const adjustedBook = r.book_balance_minor + r.unrecorded_in_minor - r.unrecorded_out_minor;
  return { adjustedBank, adjustedBook, difference: adjustedBank - adjustedBook };
}
