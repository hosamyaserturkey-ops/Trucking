import { describe, expect, it } from "vitest";
import { columnWidths, exportValue, tableRows } from "./table-export";

describe("exportValue", () => {
  it("turns shown amounts into numbers and keeps other text", () => {
    expect(exportValue({ text: "1,250.500" })).toBe(1250.5);
    expect(exportValue({ text: "-75.000" })).toBe(-75);
    expect(exportValue({ text: "12.5" })).toBe(12.5);
    expect(exportValue({ text: "0790000001" })).toBe("0790000001");
    expect(exportValue({ text: "29/10/2026" })).toBe("29/10/2026");
    expect(exportValue({ text: "4136" })).toBe("4136");
    expect(exportValue({ text: "د.أ 3,500" })).toBe("د.أ 3,500");
  });
  it("prefers the exact value the page gives, and joins lines", () => {
    expect(exportValue({ text: "1,250.000 دائن", raw: "-1250" })).toBe(-1250);
    expect(exportValue({ text: "شيك 77\n  يستحق 01/12/2026 " })).toBe("شيك 77 · يستحق 01/12/2026");
  });
});

describe("tableRows", () => {
  it("drops the action column and keeps spanned rows aligned", () => {
    const rows = tableRows([
      [{ text: "التاريخ" }, { text: "البيان" }, { text: "مدين" }, { text: "الرصيد" }, { text: "إجراءات" }],
      [{ text: "01/10/2026" }, { text: "رصيد أول المدة" }, { text: "", span: 1 }, { text: "100.000 مدين", raw: "100" }],
      [{ text: "02/10/2026" }, { text: "سند قبض" }, { text: "50.000" }, { text: "150.000 مدين", raw: "150" }, { text: "حذف" }],
      [{ text: "المجموع", span: 2 }, { text: "50.000" }, { text: "150.000 مدين", raw: "150" }],
    ]);
    expect(rows).toEqual([
      ["التاريخ", "البيان", "مدين", "الرصيد"],
      ["01/10/2026", "رصيد أول المدة", "", 100],
      ["02/10/2026", "سند قبض", 50, 150],
      ["المجموع", "", 50, 150],
    ]);
    expect(columnWidths(rows)).toEqual([12, 16, 8, 8]);
  });
});
