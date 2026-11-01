import { describe, expect, it } from "vitest";
import {
  normalizeHeader,
  parseBankAmount,
  parseBankDate,
  parseCsv,
  parseManualLine,
  parseStatementForm,
  parseStatementRows,
  reconciliationLines,
  suggestMatches,
} from "./bank";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const form = (data: Record<string, string>) => (name: string) => data[name] ?? null;

describe("parseBankAmount", () => {
  it("reads amounts as banks print them", () => {
    expect(parseBankAmount("1,250.500")).toBe(1_250_500);
    expect(parseBankAmount("(75.25)")).toBe(-75_250);
    expect(parseBankAmount("75.25-")).toBe(-75_250);
    expect(parseBankAmount("-12")).toBe(-12_000);
    expect(parseBankAmount("1250.5 CR")).toBe(1_250_500);
    expect(parseBankAmount("40 DR")).toBe(-40_000);
    expect(parseBankAmount("١٬٢٥٠٫٥")).toBe(1_250_500);
    expect(parseBankAmount("1.2345E3")).toBe(1_234_500);
    expect(parseBankAmount("JOD 10.0005")).toBe(10_001);
    expect(parseBankAmount("")).toBeNull();
    expect(parseBankAmount("-")).toBeNull();
    expect(parseBankAmount("abc")).toBeNull();
  });
});

describe("parseBankDate", () => {
  it("takes Excel serials and day-first dates, ignoring a time", () => {
    expect(parseBankDate("46296")).toBe("2026-10-01");
    expect(parseBankDate("05/10/2026 13:45")).toBe("2026-10-05");
    expect(parseBankDate("2026-10-05")).toBe("2026-10-05");
    expect(parseBankDate("٠٥/١٠/٢٠٢٦")).toBe("2026-10-05");
    expect(parseBankDate("رصيد")).toBeNull();
  });
});

describe("parseCsv", () => {
  it("handles quotes, embedded commas and the delimiter the file uses", () => {
    expect(parseCsv('﻿Date,Description,Amount\r\n01/10/2026,"Fee, monthly",-5\n')).toEqual([
      ["Date", "Description", "Amount"],
      ["01/10/2026", "Fee, monthly", "-5"],
    ]);
    expect(parseCsv('التاريخ;البيان;مدين;دائن\n01/10/2026;"قال ""مرحبا""";10;\n')).toEqual([
      ["التاريخ", "البيان", "مدين", "دائن"],
      ["01/10/2026", 'قال "مرحبا"', "10", ""],
    ]);
  });
});

describe("normalizeHeader", () => {
  it("unifies Arabic letter forms and drops punctuation", () => {
    expect(normalizeHeader("إيداع (دائن)")).toBe("ايداع دائن");
    expect(normalizeHeader("تاريخ القيمة")).toBe("تاريخ القيمه");
    expect(normalizeHeader("Value Date:")).toBe("value date");
  });
});

describe("parseStatementRows", () => {
  it("reads an Arabic statement with debit and credit columns, newest first, and its opening row", () => {
    const rows = [
      ["البنك العربي", "", "", "", "", ""],
      ["كشف حساب", "", "", "", "", ""],
      ["التاريخ", "تاريخ القيمة", "البيان", "رقم الشيك", "مدين", "دائن", "الرصيد"],
      ["05/10/2026", "06/10/2026", "شيك صادر", "000123", "250.000", "", "1,750.000"],
      ["02/10/2026", "02/10/2026", "حوالة واردة", "", "", "1,000.000", "2,000.000"],
      ["", "", "رصيد افتتاحي", "", "", "", "1,000.000"],
      ["", "", "المجموع", "", "250.000", "1,000.000", ""],
    ];
    const r = parseStatementRows(rows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.reversed).toBe(true);
    expect(r.value.lines).toEqual([
      { txn_date: "2026-10-02", value_date: "2026-10-02", description: "حوالة واردة", reference: null, amount_minor: 1_000_000, balance_minor: 2_000_000 },
      { txn_date: "2026-10-05", value_date: "2026-10-06", description: "شيك صادر", reference: "000123", amount_minor: -250_000, balance_minor: 1_750_000 },
    ]);
    expect(r.value.openingHint).toBe(1_000_000);
    expect(r.value.closingHint).toBe(1_750_000);
    expect(r.value.skipped).toBe(1);
    expect(r.value.columns.debit).toBe("مدين");
    expect(r.value.columns.value_date).toBe("تاريخ القيمة");
  });
  it("reads an English statement with one signed amount column", () => {
    const r = parseStatementRows([
      ["Posting Date", "Narrative", "Reference", "Amount", "Balance"],
      ["2026-10-01", "Bank charges", "FEE-1", "-5.000", "995.000"],
      ["2026-10-03", "Transfer in", "TT-9", "200", "1195"],
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.lines.map((l) => l.amount_minor)).toEqual([-5000, 200_000]);
    expect(r.value.openingHint).toBe(1_000_000);
    expect(r.value.closingHint).toBe(1_195_000);
    expect(r.value.reversed).toBe(false);
  });
  it("says what is missing when there is no header", () => {
    expect(parseStatementRows([["a", "b"], ["1", "2"]])).toMatchObject({ ok: false });
    expect(parseStatementRows([["التاريخ", "المبلغ"], ["x", "y"]])).toEqual({ ok: false, error: "لم أجد أي حركة بتاريخ ومبلغ في الملف" });
  });
});

describe("parseStatementForm", () => {
  const base = { account_id: ACCOUNT, period_from: "2026-10-01", period_to: "2026-10-31", opening: "1,000" };
  it("takes the header and the lines read in the browser", () => {
    const lines = [{ txn_date: "2026-10-02", amount_minor: 5000, description: "x", reference: "R", balance_minor: null, value_date: null }];
    const r = parseStatementForm(form({ ...base, lines_json: JSON.stringify(lines), source_name: "oct.xlsx" }), { today: "2026-10-31" });
    expect(r).toEqual({
      ok: true,
      values: { account_id: ACCOUNT, period_from: "2026-10-01", period_to: "2026-10-31", opening_minor: 1_000_000, lines, source_name: "oct.xlsx", notes: null },
    });
  });
  it("allows a statement with no lines yet, and refuses lines outside the period", () => {
    expect(parseStatementForm(form({ ...base, opening: "-25.5" }), { today: "2026-10-31" })).toMatchObject({ ok: true, values: { opening_minor: -25_500, lines: [] } });
    expect(
      parseStatementForm(form({ ...base, lines_json: JSON.stringify([{ txn_date: "2026-11-01", amount_minor: 1 }]) }), { today: "2026-11-30" }),
    ).toEqual({ ok: false, error: "الحركة رقم 1 (2026-11-01) خارج فترة الكشف" });
    expect(parseStatementForm(form({ ...base, lines_json: JSON.stringify([{ txn_date: "2026-10-01", amount_minor: 0 }]) }), { today: "2026-10-31" })).toEqual({
      ok: false,
      error: "الحركة رقم 1 بلا تاريخ أو مبلغ صحيح",
    });
    expect(parseStatementForm(form({ ...base, period_to: "2026-11-05" }), { today: "2026-10-31" })).toEqual({ ok: false, error: "نهاية فترة الكشف بعد اليوم" });
    expect(parseStatementForm(form({ ...base, opening: "" }), { today: "2026-10-31" })).toEqual({ ok: false, error: "أدخل رصيد أول المدة كما في كشف البنك" });
  });
});

describe("parseManualLine", () => {
  it("signs the amount by its direction", () => {
    expect(parseManualLine(form({ txn_date: "2026-10-03", amount: "5", direction: "out", description: "عمولة" }), { from: "2026-10-01", to: "2026-10-31" })).toEqual({
      ok: true,
      values: { txn_date: "2026-10-03", amount_minor: -5000, description: "عمولة", reference: null },
    });
    expect(parseManualLine(form({ txn_date: "2026-09-30", amount: "5", direction: "in" }), { from: "2026-10-01", to: "2026-10-31" })).toEqual({
      ok: false,
      error: "تاريخ الحركة خارج فترة الكشف",
    });
  });
});

describe("suggestMatches", () => {
  it("pairs equal amounts, the cheque number first, then the closest date, each line once", () => {
    const bank = [
      { id: "b1", date: "2026-10-05", amount: -250_000, text: "CHQ 000123 presented" },
      { id: "b2", date: "2026-10-06", amount: -250_000, text: "CHQ 000124" },
      { id: "b3", date: "2026-10-02", amount: 1_000_000, text: "TT IN" },
      { id: "b4", date: "2026-10-30", amount: 99_000, text: "unknown" },
    ];
    const book = [
      { id: "k1", date: "2026-10-01", amount: -250_000, refs: ["000124"] },
      { id: "k2", date: "2026-10-01", amount: -250_000, refs: ["000123"] },
      { id: "k3", date: "2026-09-29", amount: 1_000_000, refs: [null] },
      { id: "k4", date: "2026-10-01", amount: 99_000, refs: [] },
    ];
    expect(suggestMatches(bank, book)).toEqual([
      { bank: "b1", book: "k2" },
      { bank: "b2", book: "k1" },
      { bank: "b3", book: "k3" },
    ]);
  });
});

describe("reconciliationLines", () => {
  it("adjusts each side and shows what is left", () => {
    expect(
      reconciliationLines({
        bank_balance_minor: 1_000_000,
        book_balance_minor: 1_245_000,
        outstanding_in_minor: 500_000,
        outstanding_out_minor: 250_000,
        unrecorded_in_minor: 0,
        unrecorded_out_minor: 5_000,
      }),
    ).toEqual({ adjustedBank: 1_250_000, adjustedBook: 1_240_000, difference: 10_000 });
  });
});
