import { describe, expect, it } from "vitest";
import { addDays, inclusiveEnd, monthsIn, resolveRange, todayIso } from "./date-range";

describe("resolveRange", () => {
  const today = "2026-10-25";

  it("defaults to this year", () => {
    expect(resolveRange({}, today)).toMatchObject({ key: "year", from: "2026-01-01", to: "2027-01-01" });
  });

  it("this month is half-open", () => {
    expect(resolveRange({ range: "month" }, today)).toMatchObject({ from: "2026-10-01", to: "2026-11-01" });
    expect(resolveRange({ range: "month" }, "2026-12-31")).toMatchObject({ from: "2026-12-01", to: "2027-01-01" });
  });

  it("custom range includes the end day and swaps reversed dates", () => {
    expect(resolveRange({ range: "custom", from: "2026-05-01", to: "2026-05-31" }, today)).toMatchObject({
      key: "custom",
      from: "2026-05-01",
      to: "2026-06-01",
    });
    expect(resolveRange({ range: "custom", from: "2026-06-30", to: "2026-06-01" }, today)).toMatchObject({
      from: "2026-06-01",
      to: "2026-07-01",
    });
  });

  it("falls back to this year on invalid custom dates", () => {
    expect(resolveRange({ range: "custom", from: "2026-02-30", to: "2026-03-01" }, today).key).toBe("year");
    expect(resolveRange({ range: "custom", from: "nope", to: "2026-03-01" }, today).key).toBe("year");
  });
});

describe("helpers", () => {
  it("addDays crosses month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("inclusiveEnd is the last day inside the range", () => {
    expect(inclusiveEnd(resolveRange({ range: "month" }, "2026-02-10"))).toBe("2026-02-28");
  });

  it("monthsIn lists overlapping months", () => {
    const range = resolveRange({ range: "custom", from: "2026-05-15", to: "2026-07-02" }, "2026-10-25");
    expect(monthsIn(range)).toEqual(["2026-05-01", "2026-06-01", "2026-07-01"]);
  });

  it("todayIso uses the company timezone", () => {
    // 22:30 UTC on 31 Dec is already 1 Jan in Amman (UTC+3).
    expect(todayIso(new Date("2026-12-31T22:30:00Z"))).toBe("2027-01-01");
  });
});
