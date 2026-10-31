import { describe, expect, it } from "vitest";
import { amountInWords, draftPeriod, invoiceTotals, numberInWords, parseChequeStatus, parseReceipt } from "./invoicing";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const form = (data: Record<string, string>) => (name: string) => data[name] ?? null;
const today = "2026-10-28";

describe("invoiceTotals / draftPeriod", () => {
  it("adds tax on the subtotal, rounded to the fils", () => {
    expect(invoiceTotals([210_000, 185_500], 16)).toEqual({ subtotal: 395_500, vat: 63_280, total: 458_780 });
    expect(invoiceTotals([100_001], 16).vat).toBe(16_000);
    // Line by line: 16.000 + 16.000, not 16% of 200.006 (32.001).
    expect(invoiceTotals([100_003, 100_003], 16)).toEqual({ subtotal: 200_006, vat: 32_000, total: 232_006 });
    expect(invoiceTotals([100_000], 0)).toEqual({ subtotal: 100_000, vat: 0, total: 100_000 });
  });
  it("covers last month unless a period is given", () => {
    expect(draftPeriod({}, today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(draftPeriod({}, "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(draftPeriod({ from: "2026-10-20", to: "2026-10-01" }, today)).toEqual({ from: "2026-10-01", to: "2026-10-20" });
  });
});

describe("parseReceipt", () => {
  it("takes a cash receipt in JOD", () => {
    expect(parseReceipt(form({ client_id: CLIENT, method: "cash", amount: "1,250.5" }), { today })).toEqual({
      ok: true,
      values: {
        client_id: CLIENT,
        received_on: today,
        method: "cash",
        amount_minor: 1_250_500,
        reference_no: null,
        cheque_no: null,
        cheque_bank: null,
        cheque_due_date: null,
        cheque_status: null,
        notes: null,
      },
    });
  });
  it("a cheque needs its number and due date, and starts in hand", () => {
    expect(parseReceipt(form({ client_id: CLIENT, method: "cheque", amount: "500" }), { today })).toEqual({ ok: false, error: "أدخل رقم الشيك" });
    expect(parseReceipt(form({ client_id: CLIENT, method: "cheque", amount: "500", cheque_no: "١٢٣" }), { today }).ok).toBe(false);
    const r = parseReceipt(
      form({ client_id: CLIENT, method: "cheque", amount: "500", cheque_no: "123", cheque_bank: "البنك العربي", cheque_due_date: "2026-12-01" }),
      { today },
    );
    expect(r.ok && r.values).toMatchObject({ cheque_no: "123", cheque_due_date: "2026-12-01", cheque_status: "in_hand" });
  });
  it("keeps cheque fields off other methods, and a transfer's reference", () => {
    const r = parseReceipt(form({ client_id: CLIENT, method: "bank", amount: "10", reference_no: "TRF-9", cheque_no: "1" }), { today });
    expect(r.ok && r.values).toMatchObject({ reference_no: "TRF-9", cheque_no: null, cheque_status: null });
  });
  it("refuses a missing customer, a future date, an unknown method and a zero amount", () => {
    expect(parseReceipt(form({ method: "cash", amount: "1" }), { today }).ok).toBe(false);
    expect(parseReceipt(form({ client_id: CLIENT, method: "cash", amount: "1", received_on: "2026-10-29" }), { today }).ok).toBe(false);
    expect(parseReceipt(form({ client_id: CLIENT, method: "card", amount: "1" }), { today }).ok).toBe(false);
    expect(parseReceipt(form({ client_id: CLIENT, method: "cash", amount: "0" }), { today }).ok).toBe(false);
  });
});

describe("parseChequeStatus", () => {
  const opts = { receivedOn: "2026-10-10", today };
  it("dates a deposit, clearing or bounce (today by default)", () => {
    expect(parseChequeStatus(form({ cheque_status: "cleared" }), opts)).toEqual({
      ok: true,
      values: { cheque_status: "cleared", cheque_status_on: today },
    });
    expect(parseChequeStatus(form({ cheque_status: "in_hand", status_on: "2026-10-20" }), opts)).toEqual({
      ok: true,
      values: { cheque_status: "in_hand", cheque_status_on: null },
    });
  });
  it("refuses a date before the cheque was received, or in the future", () => {
    expect(parseChequeStatus(form({ cheque_status: "bounced", status_on: "2026-10-01" }), opts).ok).toBe(false);
    expect(parseChequeStatus(form({ cheque_status: "bounced", status_on: "2026-11-01" }), opts).ok).toBe(false);
    expect(parseChequeStatus(form({ cheque_status: "lost" }), opts).ok).toBe(false);
  });
});

describe("amounts in words", () => {
  it("writes numbers the way invoices do", () => {
    expect(numberInWords(35)).toBe("خمسة وثلاثون");
    expect(numberInWords(101)).toBe("مائة وواحد");
    expect(numberInWords(120)).toBe("مائة وعشرون");
    expect(numberInWords(1235)).toBe("ألف ومائتان وخمسة وثلاثون");
    expect(numberInWords(2000)).toBe("ألفان");
    expect(numberInWords(3000)).toBe("ثلاثة آلاف");
    expect(numberInWords(15_400)).toBe("خمسة عشر ألف وأربعمائة");
    expect(numberInWords(2_500_000)).toBe("مليونان وخمسمائة ألف");
  });
  it("writes dinars and fils", () => {
    expect(amountInWords(1_235_500)).toBe("فقط ألف ومائتان وخمسة وثلاثون دينار أردني وخمسمائة فلس لا غير");
    expect(amountInWords(458_780)).toBe("فقط أربعمائة وثمانية وخمسون دينار أردني وسبعمائة وثمانون فلس لا غير");
    expect(amountInWords(500)).toBe("فقط خمسمائة فلس لا غير");
    expect(amountInWords(7_000)).toBe("فقط سبعة دينار أردني لا غير");
  });
});
