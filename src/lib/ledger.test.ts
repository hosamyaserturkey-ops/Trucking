import { describe, expect, it } from "vitest";
import { balanceSide, filterQuery, sourceHref, sourceLabel, statementAccounts, statementFilter, withRunningBalance } from "./ledger";

const TRUCK = "11111111-1111-4111-8111-111111111111";

describe("statementFilter", () => {
  it("defaults to this month so far", () => {
    expect(statementFilter({}, "2026-10-27")).toEqual({ from: "2026-10-01", to: "2026-10-27", truck: "", supplier: "", driver: "", client: "" });
  });
  it("takes a period (swapped if needed) and valid ids only", () => {
    expect(statementFilter({ from: "2026-10-20", to: "2026-09-01", truck: TRUCK, driver: "x" }, "2026-10-27")).toMatchObject({
      from: "2026-09-01",
      to: "2026-10-20",
      truck: TRUCK,
      driver: "",
    });
  });
  it("round-trips through the query string", () => {
    const f = statementFilter({ from: "2026-09-01", to: "2026-09-30", truck: TRUCK }, "2026-10-27");
    expect(filterQuery(f)).toBe(`from=2026-09-01&to=2026-09-30&truck=${TRUCK}`);
  });
});

describe("withRunningBalance / balanceSide", () => {
  it("adds debits and takes off credits from the opening balance", () => {
    const rows = withRunningBalance(10_000, [
      { debit_minor: 5_000, credit_minor: 0 },
      { debit_minor: 0, credit_minor: 20_000 },
    ]);
    expect(rows.map((r) => r.balance_minor)).toEqual([15_000, -5_000]);
  });
  it("names the side of a balance", () => {
    expect(balanceSide(15_000)).toEqual({ minor: 15_000, side: "مدين" });
    expect(balanceSide(-5_000)).toEqual({ minor: 5_000, side: "دائن" });
    expect(balanceSide(0)).toEqual({ minor: 0, side: "" });
  });
});

describe("statementAccounts", () => {
  const accounts = [
    { id: "a", parent_id: null, is_postable: false, type: "expense" },
    { id: "a1", parent_id: "a", is_postable: true, type: "expense" },
    { id: "a2", parent_id: "a", is_postable: false, type: "expense" },
    { id: "a21", parent_id: "a2", is_postable: true, type: "expense" },
    { id: "c", parent_id: null, is_postable: true, type: "asset" },
  ];
  it("covers an account, or everything under a parent account", () => {
    expect(statementAccounts("c", accounts)).toEqual(["c"]);
    expect(statementAccounts("a", accounts)).toEqual(["a1", "a21"]);
    expect(statementAccounts("missing", accounts)).toEqual([]);
  });
  it('"expenses" is every postable expense account', () => {
    expect(statementAccounts("expenses", accounts)).toEqual(["a1", "a21"]);
  });
});

describe("sources", () => {
  it("labels and links what an entry comes from", () => {
    expect(sourceLabel("expense")).toBe("مصروف");
    expect(sourceLabel(null)).toBe("قيد يدوي");
    expect(sourceHref("fuel", "f1")).toBe("/diesel/f1/edit");
    expect(sourceHref("advance", "a1")).toBeNull();
    expect(sourceLabel("issued_cheque")).toBe("شيك صادر");
    expect(sourceHref("supplier_payment", "p1")).toBe("/print/payments/p1");
  });
});
