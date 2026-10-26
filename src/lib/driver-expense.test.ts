import { describe, expect, it } from "vitest";
import { parseDriverExpense } from "./driver-expense";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TRIP = "11111111-1111-4111-8111-111111111111";
const CAT = "22222222-2222-4222-8222-222222222222";
const opts = { userId: USER, allowedCategoryIds: [CAT], today: "2026-10-26" };
const form = (data: Record<string, string>) => (name: string) => data[name] ?? null;
const base = { trip_id: TRIP, category_id: CAT, amount: "12.5" };

describe("parseDriverExpense", () => {
  it("defaults to today, JOD and paid by the driver", () => {
    expect(parseDriverExpense(form(base), opts)).toEqual({
      ok: true,
      values: {
        trip_id: TRIP,
        category_id: CAT,
        expense_date: "2026-10-26",
        currency: "JOD",
        amount_minor: 12_500,
        payment_method: "driver_advance",
        description: null,
        receipt_path: null,
      },
    });
  });

  it("accepts a receipt only from the driver's own folder", () => {
    const own = parseDriverExpense(form({ ...base, receipt_path: `${USER}/2026-10/x.jpg` }), opts);
    expect(own.ok && own.values.receipt_path).toBe(`${USER}/2026-10/x.jpg`);
    expect(parseDriverExpense(form({ ...base, receipt_path: "someone-else/2026-10/x.jpg" }), opts).ok).toBe(false);
  });

  it("parses USD in cents", () => {
    const r = parseDriverExpense(form({ ...base, currency: "USD", amount: "45" }), opts);
    expect(r.ok && r.values).toMatchObject({ currency: "USD", amount_minor: 4500 });
  });

  it("rejects future dates, unknown categories, payment methods and bad amounts", () => {
    expect(parseDriverExpense(form({ ...base, expense_date: "2026-10-27" }), opts).ok).toBe(false);
    expect(parseDriverExpense(form({ ...base, category_id: TRIP }), opts).ok).toBe(false);
    expect(parseDriverExpense(form({ ...base, payment_method: "bank" }), opts).ok).toBe(false);
    expect(parseDriverExpense(form({ ...base, amount: "0" }), opts).ok).toBe(false);
    expect(parseDriverExpense(form({ ...base, amount: "abc" }), opts).ok).toBe(false);
    expect(parseDriverExpense(form({ ...base, trip_id: "" }), opts).ok).toBe(false);
  });
});
