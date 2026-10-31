import { describe, expect, it } from "vitest";
import { formatPct, marginPct, orderClientRows, parseBasis, perKm, sumRows } from "./reports";

describe("parseBasis", () => {
  it("takes a known basis, revenue otherwise", () => {
    expect(parseBasis("loads")).toBe("loads");
    expect(parseBasis("km")).toBe("km");
    expect(parseBasis("tons")).toBe("revenue");
    expect(parseBasis(undefined)).toBe("revenue");
    expect(parseBasis("constructor")).toBe("revenue");
  });
});

describe("marginPct", () => {
  it("is profit over revenue, to one decimal", () => {
    expect(marginPct(250, 1000)).toBe(25);
    expect(marginPct(1, 3)).toBe(33.3);
    expect(marginPct(-500, 1000)).toBe(-50);
    expect(marginPct(10, 0)).toBeNull();
    expect(formatPct(33.3)).toBe("33.3%");
    expect(formatPct(null)).toBe("—");
  });
});

describe("sumRows and perKm", () => {
  it("adds the columns and divides by km", () => {
    expect(sumRows([{ a: 1, b: 2 }, { a: 3, b: null }], ["a", "b"] as const)).toEqual({ a: 4, b: 2 });
    expect(perKm(1_000_000, 3)).toBe(333333);
    expect(perKm(1000, 0)).toBeNull();
  });
});

describe("orderClientRows", () => {
  it("lists customers by profit, then loads with no customer, then idle trucks", () => {
    const row = (client_id: string | null, is_idle: boolean, profit_minor: number) => ({
      client_id,
      is_idle,
      profit_minor,
      loads: 0,
      revenue_minor: 0,
      direct_minor: 0,
      allocated_minor: 0,
    });
    const ordered = orderClientRows([row(null, true, -9), row("a", false, 5), row(null, false, 100), row("b", false, 50)]);
    expect(ordered.map((r) => [r.client_id, r.is_idle])).toEqual([
      ["b", false],
      ["a", false],
      [null, false],
      [null, true],
    ]);
  });
});
