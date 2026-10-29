import { describe, expect, it } from "vitest";
import { openingAmount, parseOpeningAdvance, parseOpeningBalance, parseOpeningCheque, parseOpeningDate, signedOpening } from "./opening";

const ID = "11111111-1111-4111-8111-111111111111";
const form = (data: Record<string, string>) => (name: string) => data[name] ?? null;

describe("openingAmount / signedOpening", () => {
  it("puts the amount on the chosen side", () => {
    expect(openingAmount("١٬٢٥٠٫٥", "debit")).toEqual({ ok: true, values: { debit_minor: 1_250_500, credit_minor: 0 } });
    expect(openingAmount("300", "credit")).toEqual({ ok: true, values: { debit_minor: 0, credit_minor: 300_000 } });
    expect(openingAmount("0", "debit")).toEqual({ ok: false, error: "أدخل الرصيد (أكبر من صفر)" });
    expect(openingAmount("5", "x")).toEqual({ ok: false, error: "اختر جهة الرصيد" });
  });
  it("reads a signed spreadsheet balance against the party's usual side", () => {
    expect(signedOpening("", "debit")).toEqual({ ok: true, values: null });
    expect(signedOpening("0", "debit")).toEqual({ ok: true, values: null });
    expect(signedOpening("1,500", "debit")).toEqual({ ok: true, values: { debit_minor: 1_500_000, credit_minor: 0 } });
    expect(signedOpening("-200", "debit")).toEqual({ ok: true, values: { debit_minor: 0, credit_minor: 200_000 } });
    expect(signedOpening("(200)", "credit")).toEqual({ ok: true, values: { debit_minor: 200_000, credit_minor: 0 } });
    expect(signedOpening("750.25", "credit")).toEqual({ ok: true, values: { debit_minor: 0, credit_minor: 750_250 } });
    expect(signedOpening("abc", "credit")).toEqual({ ok: false, error: "الرصيد الافتتاحي غير صحيح" });
  });
});

describe("parseOpeningBalance / parseOpeningAdvance / parseOpeningCheque", () => {
  it("needs the account, customer or supplier and an amount", () => {
    expect(parseOpeningBalance("client", form({ amount: "5", side: "debit" }))).toEqual({ ok: false, error: "اختر الزبون" });
    expect(parseOpeningBalance("supplier", form({ target_id: ID, amount: "5", side: "credit", notes: " كشف 2026 " }))).toEqual({
      ok: true,
      values: { target_id: ID, notes: "كشف 2026", debit_minor: 0, credit_minor: 5_000 },
    });
  });
  it("an advance needs the driver and an amount", () => {
    expect(parseOpeningAdvance(form({ amount: "5" }))).toEqual({ ok: false, error: "اختر السائق" });
    expect(parseOpeningAdvance(form({ driver_id: ID, amount: "120.5" }))).toEqual({ ok: true, values: { driver_id: ID, amount_minor: 120_500 } });
  });
  it("a cheque needs its number and due date", () => {
    expect(parseOpeningCheque(form({ party_id: ID, amount: "100" }))).toEqual({ ok: false, error: "أدخل رقم الشيك" });
    expect(parseOpeningCheque(form({ party_id: ID, amount: "100", cheque_no: "77" }))).toEqual({ ok: false, error: "أدخل تاريخ استحقاق الشيك" });
    expect(parseOpeningCheque(form({ party_id: ID, amount: "100", cheque_no: "77", cheque_bank: "بنك الإسكان", cheque_due_date: "2026-12-01" }))).toEqual({
      ok: true,
      values: { party_id: ID, amount_minor: 100_000, cheque_no: "77", cheque_bank: "بنك الإسكان", cheque_due_date: "2026-12-01" },
    });
  });
});

describe("parseOpeningDate", () => {
  it("takes a real date, not one far ahead", () => {
    expect(parseOpeningDate("2026-11-01", "2026-10-29")).toEqual({ ok: true, date: "2026-11-01" });
    expect(parseOpeningDate("", "2026-10-29")).toEqual({ ok: false, error: "أدخل تاريخ بدء العمل" });
    expect(parseOpeningDate("2028-01-01", "2026-10-29")).toEqual({ ok: false, error: "تاريخ بدء العمل بعيد جداً" });
  });
});
