import { describe, expect, it } from "vitest";
import { perUnit, pnlTotals } from "./pnl";

describe("pnlTotals", () => {
  it("sums revenue and every cost kind", () => {
    const totals = pnlTotals([
      { kind: "revenue", amount_base_minor: 1_000_000 },
      { kind: "revenue", amount_base_minor: 500_000 },
      { kind: "fuel", amount_base_minor: 300_000 },
      { kind: "maintenance", amount_base_minor: 100_000 },
      { kind: "expense", amount_base_minor: 50_000 },
      { kind: "depreciation", amount_base_minor: 40_000 },
      { kind: "interest", amount_base_minor: 10_000 },
      { kind: "overhead", amount_base_minor: 25_001 },
    ]);
    expect(totals.revenue).toBe(1_500_000);
    expect(totals.costs).toBe(525_001);
    expect(totals.profit).toBe(974_999);
    expect(totals.byKind.fuel).toBe(300_000);
  });

  it("handles no data", () => {
    expect(pnlTotals([])).toEqual({ revenue: 0, costs: 0, profit: 0, byKind: {} });
  });

  it("reports losses as negative profit", () => {
    expect(pnlTotals([{ kind: "fuel", amount_base_minor: 1000 }]).profit).toBe(-1000);
  });
});

describe("perUnit", () => {
  it("rounds to whole fils and guards against zero", () => {
    expect(perUnit(1000, 3)).toBe(333);
    expect(perUnit(2000, 3)).toBe(667);
    expect(perUnit(-2000, 3)).toBe(-667);
    expect(perUnit(1000, 0)).toBeNull();
  });
});
