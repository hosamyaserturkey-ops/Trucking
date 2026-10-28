import { describe, expect, it } from "vitest";
import { parseIssuedChequeStatus, parseSupplierPayment } from "./payables";

const SUPPLIER = "11111111-1111-4111-8111-111111111111";
const form = (data: Record<string, string>) => (name: string) => data[name] ?? null;
const today = "2026-10-28";

describe("parseSupplierPayment", () => {
  it("takes a cash payment in JOD with its voucher number", () => {
    expect(parseSupplierPayment(form({ supplier_id: SUPPLIER, method: "cash", amount: "٢٬٥٠٠", voucher_no: " ٧٧١ " }), { today })).toEqual({
      ok: true,
      values: {
        supplier_id: SUPPLIER,
        paid_on: today,
        method: "cash",
        amount_minor: 2_500_000,
        voucher_no: "771",
        reference_no: null,
        cheque_no: null,
        cheque_bank: null,
        cheque_due_date: null,
        cheque_status: null,
        notes: null,
      },
    });
  });
  it("a cheque needs its number and due date, and starts issued", () => {
    expect(parseSupplierPayment(form({ supplier_id: SUPPLIER, method: "cheque", amount: "500" }), { today })).toEqual({ ok: false, error: "أدخل رقم الشيك" });
    expect(parseSupplierPayment(form({ supplier_id: SUPPLIER, method: "cheque", amount: "500", cheque_no: "1" }), { today })).toEqual({
      ok: false,
      error: "أدخل تاريخ استحقاق الشيك",
    });
    const ok = parseSupplierPayment(
      form({ supplier_id: SUPPLIER, method: "cheque", amount: "500", cheque_no: "OUT-9", cheque_bank: "البنك العربي", cheque_due_date: "2026-12-01", reference_no: "x" }),
      { today },
    );
    expect(ok.ok && ok.values).toMatchObject({ cheque_no: "OUT-9", cheque_bank: "البنك العربي", cheque_due_date: "2026-12-01", cheque_status: "issued", reference_no: null });
  });
  it("keeps a transfer's reference but no cheque fields", () => {
    const ok = parseSupplierPayment(form({ supplier_id: SUPPLIER, method: "bank", amount: "10", reference_no: "TRX-1", cheque_no: "9" }), { today });
    expect(ok.ok && ok.values).toMatchObject({ reference_no: "TRX-1", cheque_no: null, cheque_status: null });
  });
  it("refuses a missing supplier, a future date, no amount or an unknown method", () => {
    expect(parseSupplierPayment(form({ method: "cash", amount: "1" }), { today })).toEqual({ ok: false, error: "اختر المورد" });
    expect(parseSupplierPayment(form({ supplier_id: SUPPLIER, method: "cash", amount: "1", paid_on: "2026-10-29" }), { today })).toEqual({
      ok: false,
      error: "تاريخ الدفع غير صحيح",
    });
    expect(parseSupplierPayment(form({ supplier_id: SUPPLIER, method: "cash", amount: "0" }), { today })).toEqual({ ok: false, error: "أدخل المبلغ" });
    expect(parseSupplierPayment(form({ supplier_id: SUPPLIER, method: "card", amount: "1" }), { today })).toEqual({ ok: false, error: "اختر طريقة الدفع" });
    expect(parseSupplierPayment(form({ supplier_id: SUPPLIER, method: "cash", amount: "1", voucher_no: "x".repeat(31) }), { today })).toEqual({
      ok: false,
      error: "رقم سند الصرف طويل جداً",
    });
  });
});

describe("parseIssuedChequeStatus", () => {
  it("cleared or bounced on a day, issued without one", () => {
    expect(parseIssuedChequeStatus(form({ cheque_status: "cleared", status_on: "2026-10-20" }), { paidOn: "2026-10-01", today })).toEqual({
      ok: true,
      values: { cheque_status: "cleared", cheque_status_on: "2026-10-20" },
    });
    expect(parseIssuedChequeStatus(form({ cheque_status: "issued", status_on: "2026-10-20" }), { paidOn: "2026-10-01", today })).toEqual({
      ok: true,
      values: { cheque_status: "issued", cheque_status_on: null },
    });
  });
  it("refuses a day before the cheque was issued or in the future", () => {
    expect(parseIssuedChequeStatus(form({ cheque_status: "bounced", status_on: "2026-09-30" }), { paidOn: "2026-10-01", today })).toEqual({
      ok: false,
      error: "التاريخ قبل تاريخ إصدار الشيك",
    });
    expect(parseIssuedChequeStatus(form({ cheque_status: "cleared", status_on: "2026-11-01" }), { paidOn: "2026-10-01", today })).toEqual({
      ok: false,
      error: "التاريخ غير صحيح",
    });
    expect(parseIssuedChequeStatus(form({ cheque_status: "deposited" }), { paidOn: "2026-10-01", today })).toEqual({ ok: false, error: "حالة الشيك غير صحيحة" });
  });
});
