import { describe, expect, it } from "vitest";
import { parseOfficeExpense } from "./expense-parse";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TRUCK = "11111111-1111-4111-8111-111111111111";
const DRIVER = "33333333-3333-4333-8333-333333333333";
const CAT = "22222222-2222-4222-8222-222222222222";
const opts = { userId: USER, today: "2026-10-26", allowedCategoryIds: [CAT] };
const form = (data: Record<string, string>) => (name: string) => data[name] ?? null;
const base = { category_id: CAT, description: "إطار أمامي", amount: "320" };

describe("parseOfficeExpense", () => {
  it("parses a truck expense", () => {
    expect(parseOfficeExpense(form({ ...base, truck_id: TRUCK, payment_method: "bank", reference_no: "INV-77" }), opts)).toEqual({
      ok: true,
      values: {
        cost_scope: "truck",
        truck_id: TRUCK,
        trip_id: null,
        driver_id: null,
        category_id: CAT,
        supplier_id: null,
        description: "إطار أمامي",
        expense_date: "2026-10-26",
        currency: "JOD",
        amount_minor: 320000,
        fx_rate: 1,
        payment_method: "bank",
        reference_no: "INV-77",
        receipt_upload: null,
      },
    });
  });

  it("overhead has no truck, trip or driver", () => {
    const r = parseOfficeExpense(form({ ...base, cost_scope: "overhead", truck_id: TRUCK, driver_id: DRIVER }), opts);
    expect(r.ok && r.values).toMatchObject({ cost_scope: "overhead", truck_id: null, trip_id: null, driver_id: null });
  });

  it("a truck expense needs its truck", () => {
    expect(parseOfficeExpense(form(base), opts).ok).toBe(false);
  });

  it("paid from an advance needs the driver", () => {
    expect(parseOfficeExpense(form({ ...base, truck_id: TRUCK, payment_method: "driver_advance" }), opts).ok).toBe(false);
    expect(parseOfficeExpense(form({ ...base, truck_id: TRUCK, driver_id: DRIVER, payment_method: "driver_advance" }), opts).ok).toBe(true);
  });

  it("refuses unknown categories, future dates, missing text and bad USD rates", () => {
    expect(parseOfficeExpense(form({ ...base, truck_id: TRUCK, category_id: TRUCK }), opts).ok).toBe(false);
    expect(parseOfficeExpense(form({ ...base, truck_id: TRUCK, expense_date: "2026-10-27" }), opts).ok).toBe(false);
    expect(parseOfficeExpense(form({ ...base, truck_id: TRUCK, description: " " }), opts).ok).toBe(false);
    expect(parseOfficeExpense(form({ ...base, truck_id: TRUCK, currency: "USD" }), opts).ok).toBe(false);
    const usd = parseOfficeExpense(form({ ...base, truck_id: TRUCK, currency: "USD", fx_rate: "0.709" }), opts);
    expect(usd.ok && usd.values).toMatchObject({ amount_minor: 32000, fx_rate: 0.709 });
  });

  it("only takes receipts from the user's own upload folder", () => {
    const ok = parseOfficeExpense(form({ ...base, truck_id: TRUCK, receipt_upload: `tmp/receipts/${USER}/2026-10/a.pdf` }), opts);
    expect(ok.ok).toBe(true);
    expect(parseOfficeExpense(form({ ...base, truck_id: TRUCK, receipt_upload: "tmp/receipts/x/2026-10/a.pdf" }), opts).ok).toBe(false);
  });
});
