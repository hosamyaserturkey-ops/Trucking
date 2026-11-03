import { describe, expect, it } from "vitest";
import { invoicePayments, monthlyClaims, payStateTotals, refCandidates } from "./client-loads";

describe("refCandidates", () => {
  it("keeps an exact reference", () => {
    expect(refCandidates("ARB-0041")).toEqual(["ARB-0041"]);
  });

  it("accepts lower case, spaces, Arabic digits, no dash and no leading zeros", () => {
    expect(refCandidates(" arb-41 ")).toContain("ARB-0041");
    expect(refCandidates("ARB0041")).toContain("ARB-0041");
    expect(refCandidates("ARB-٤١")).toContain("ARB-0041");
    expect(refCandidates("arb 41")).toContain("ARB-0041");
  });

  it("keeps codes with digits when the dash is there", () => {
    expect(refCandidates("C07-12")).toContain("C07-0012");
  });

  it("keeps whatever was typed, for a customer's own document number", () => {
    expect(refCandidates("BL-778/2026")).toEqual(["BL-778/2026"]);
    expect(refCandidates("  ")).toEqual([]);
  });
});

describe("invoicePayments", () => {
  const inv = [
    { id: "b", invoice_no: 2, invoice_date: "2026-09-10", total_minor: 300_000 },
    { id: "a", invoice_no: 1, invoice_date: "2026-08-01", total_minor: 200_000 },
    { id: "c", invoice_no: 3, invoice_date: "2026-10-05", total_minor: 100_000 },
  ];

  it("pays the oldest invoice first; what is owed is the newest part", () => {
    const p = invoicePayments(inv, 250_000); // paid 350,000 of 600,000
    expect(p.get("a")).toMatchObject({ paid_minor: 200_000, remaining_minor: 0, state: "paid" });
    expect(p.get("b")).toMatchObject({ paid_minor: 150_000, remaining_minor: 150_000, state: "partial" });
    expect(p.get("c")).toMatchObject({ paid_minor: 0, remaining_minor: 100_000, state: "unpaid" });
  });

  it("marks everything paid when nothing is owed, or when he paid in advance", () => {
    expect([...invoicePayments(inv, 0).values()].every((r) => r.state === "paid")).toBe(true);
    expect([...invoicePayments(inv, -50_000).values()].every((r) => r.state === "paid")).toBe(true);
  });

  it("leaves every invoice unpaid when the balance covers them all (opening balance still owed too)", () => {
    const p = invoicePayments(inv, 900_000);
    expect([...p.values()].map((r) => r.state)).toEqual(["unpaid", "unpaid", "unpaid"]);
  });

  it("counts invoices by state", () => {
    const t = payStateTotals([...invoicePayments(inv, 250_000).values()]);
    expect(t.paid).toEqual({ count: 1, total_minor: 200_000, remaining_minor: 0 });
    expect(t.partial).toEqual({ count: 1, total_minor: 300_000, remaining_minor: 150_000 });
    expect(t.unpaid).toEqual({ count: 1, total_minor: 100_000, remaining_minor: 100_000 });
  });
});

describe("monthlyClaims", () => {
  it("groups loads by month of their date, claimed and not claimed", () => {
    expect(
      monthlyClaims([
        { date: "2026-10-03", invoiced: true, amount_minor: 180_000 },
        { date: "2026-09-28", invoiced: true, amount_minor: 100_000 },
        { date: "2026-10-20", invoiced: false, amount_minor: 90_000 },
        { date: "2026-10-21", invoiced: false, amount_minor: 10_000 },
      ]),
    ).toEqual([
      { month: "2026-09", claimed: { loads: 1, amount_minor: 100_000 }, unclaimed: { loads: 0, amount_minor: 0 } },
      { month: "2026-10", claimed: { loads: 1, amount_minor: 180_000 }, unclaimed: { loads: 2, amount_minor: 100_000 } },
    ]);
  });
});
