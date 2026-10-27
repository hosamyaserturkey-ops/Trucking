import { describe, expect, it } from "vitest";
import { formatMoney, parseMoney, sumMinor } from "./money";

describe("formatMoney", () => {
  it("formats JOD fils with three decimals and grouping", () => {
    expect(formatMoney(1234567, "JOD")).toBe("1,234.567 د.أ");
    expect(formatMoney(5, "JOD")).toBe("0.005 د.أ");
    expect(formatMoney(0, "JOD")).toBe("0.000 د.أ");
  });

  it("formats USD cents with two decimals", () => {
    expect(formatMoney(215000, "USD")).toBe("2,150.00 $");
  });

  it("handles negatives", () => {
    expect(formatMoney(-125000, "JOD")).toBe("-125.000 د.أ");
  });

  it("rounds half up when showing fewer decimals", () => {
    expect(formatMoney(1234500, "JOD", { fractionDigits: 0 })).toBe("1,235 د.أ");
    expect(formatMoney(1234499, "JOD", { fractionDigits: 0 })).toBe("1,234 د.أ");
    expect(formatMoney(-1500, "JOD", { fractionDigits: 0 })).toBe("-2 د.أ");
    expect(formatMoney(-400, "JOD", { fractionDigits: 0 })).toBe("0 د.أ");
  });

  it("is exact for large amounts", () => {
    expect(formatMoney(9007199254740991n, "JOD", { withCurrency: false })).toBe("9,007,199,254,740.991");
  });

  it("shows a dash for missing values", () => {
    expect(formatMoney(null)).toBe("—");
  });
});

describe("parseMoney", () => {
  it("parses plain and grouped amounts", () => {
    expect(parseMoney("1,234.5", "JOD")).toBe(1234500n);
    expect(parseMoney("12", "USD")).toBe(1200n);
    expect(parseMoney("0.005", "JOD")).toBe(5n);
  });

  it("parses Arabic-Indic digits and the Arabic decimal separator", () => {
    expect(parseMoney("١٢٣٤٫٥", "JOD")).toBe(1234500n);
  });

  it("rejects too many decimals and junk", () => {
    expect(parseMoney("1.2345", "JOD")).toBeNull();
    expect(parseMoney("1.234", "USD")).toBeNull();
    expect(parseMoney("abc", "JOD")).toBeNull();
    expect(parseMoney("1e3", "JOD")).toBeNull();
    expect(parseMoney("", "JOD")).toBeNull();
  });
});

describe("sumMinor", () => {
  it("adds integers and skips nulls", () => {
    expect(sumMinor([100, null, 250, undefined])).toBe(350);
  });

  it("refuses non-integers", () => {
    expect(() => sumMinor([1.5])).toThrow();
  });
});
