import { describe, expect, it } from "vitest";
import { openLedger, parseAdvance, parseApproval, parseRejection, settlementPreview, type LedgerInput } from "./advances";

const form = (data: Record<string, string>) => (name: string) => data[name] ?? null;
const DRIVER = "11111111-1111-4111-8111-111111111111";
const CAT = "22222222-2222-4222-8222-222222222222";

describe("parseApproval", () => {
  const opts = { currency: "JOD", allowedCategoryIds: [CAT] };
  it("accepts a corrected amount and forces rate 1 for JOD", () => {
    expect(parseApproval(form({ category_id: CAT, amount: "9.5", fx_rate: "3" }), opts)).toEqual({
      ok: true,
      values: { category_id: CAT, amount_minor: 9500, fx_rate: 1 },
    });
  });
  it("needs a valid rate for USD", () => {
    const usd = { ...opts, currency: "USD" };
    expect(parseApproval(form({ category_id: CAT, amount: "45", fx_rate: "0.709" }), usd)).toMatchObject({
      ok: true,
      values: { amount_minor: 4500, fx_rate: 0.709 },
    });
    expect(parseApproval(form({ category_id: CAT, amount: "45", fx_rate: "0" }), usd).ok).toBe(false);
  });
  it("rejects unknown categories and bad amounts", () => {
    expect(parseApproval(form({ category_id: DRIVER, amount: "1" }), opts).ok).toBe(false);
    expect(parseApproval(form({ category_id: CAT, amount: "-1" }), opts).ok).toBe(false);
    expect(parseApproval(form({ category_id: CAT, amount: "1.2345" }), opts).ok).toBe(false);
  });
});

describe("parseRejection", () => {
  it("requires a reason", () => {
    expect(parseRejection(form({ reason: "  " })).ok).toBe(false);
    expect(parseRejection(form({ reason: " لا يوجد إيصال " }))).toEqual({ ok: true, values: { rejection_reason: "لا يوجد إيصال" } });
  });
});

describe("parseAdvance", () => {
  const today = "2026-10-26";
  it("defaults to today, JOD and cash", () => {
    expect(parseAdvance(form({ driver_id: DRIVER, amount: "150" }), { today })).toEqual({
      ok: true,
      values: { driver_id: DRIVER, trip_id: null, issued_on: today, currency: "JOD", amount_minor: 150_000, fx_rate: 1, method: "cash", notes: null },
    });
  });
  it("rejects future dates, missing driver and bad methods", () => {
    expect(parseAdvance(form({ driver_id: DRIVER, amount: "1", issued_on: "2026-10-27" }), { today }).ok).toBe(false);
    expect(parseAdvance(form({ amount: "1" }), { today }).ok).toBe(false);
    expect(parseAdvance(form({ driver_id: DRIVER, amount: "1", method: "card" }), { today }).ok).toBe(false);
    expect(parseAdvance(form({ driver_id: DRIVER, amount: "1", currency: "USD", fx_rate: "" }), { today }).ok).toBe(false);
  });
});

describe("openLedger and settlementPreview", () => {
  const items: LedgerInput[] = [
    { id: "e1", kind: "expense", date: "2026-10-05", base_minor: 12_000 },
    { id: "a1", kind: "advance", date: "2026-10-01", base_minor: 150_000 },
    { id: "e2", kind: "expense", date: "2026-10-20", base_minor: 160_000 },
    { id: "a2", kind: "advance", date: "2026-10-05", base_minor: 20_000 },
  ];
  it("orders by date, advances first on the same day, with a running balance", () => {
    const rows = openLedger(items);
    expect(rows.map((r) => r.id)).toEqual(["a1", "a2", "e1", "e2"]);
    expect(rows.map((r) => r.balance_minor)).toEqual([150_000, 170_000, 158_000, -2_000]);
    expect(rows[3].signed_minor).toBe(-160_000);
  });
  it("previews exactly what a settlement on a date would close", () => {
    expect(settlementPreview(items, "2026-10-10")).toEqual({ count: 3, advances: 170_000, expenses: 12_000, difference: 158_000 });
    expect(settlementPreview(items, "2026-10-26").difference).toBe(-2_000);
    expect(settlementPreview(items, "2026-09-30").count).toBe(0);
  });
});
