import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { columnName, excelDate, readSheet, writeSheet, XlsxError } from "./xlsx";

describe("readSheet", () => {
  it("reads a workbook written by another program (openpyxl): first sheet only", () => {
    const rows = readSheet(new Uint8Array(readFileSync(join(__dirname, "__fixtures__", "openpyxl-clients.xlsx"))));
    expect(rows[0]).toEqual(["الاسم", "الهاتف", "مدة السداد (يوم)", "الرصيد الافتتاحي", "تاريخ"]);
    expect(rows[1].slice(0, 4)).toEqual(["شركة الأفق & شركاه", "0790000001", "30", "1250.5"]);
    expect(excelDate(rows[1][4])).toBe("2026-12-31");
    expect(rows[2]).toEqual(["مؤسسة <النور>", "", "45", "-200", "31/01/2027"]);
    expect(rows[3]).toEqual([]);
    expect(rows[4]).toEqual(["زبون بمسافات", "", "60", "0"]);
    expect(rows).toHaveLength(5);
  });

  it("reads Excel's shared strings, rich text runs and prefixed tags", () => {
    const file = zipSync({
      "xl/workbook.xml": strToU8(
        `<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="r"><x:sheets><x:sheet name="S" sheetId="1" r:id="rId7"/></x:sheets></x:workbook>`,
      ),
      "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Target="worksheets/data.xml" Id="rId7" Type="t"/></Relationships>`),
      "xl/sharedStrings.xml": strToU8(
        `<sst count="2"><si><t>رقم الأسطول</t></si><si><r><t>T-</t></r><r><rPr><b/></rPr><t xml:space="preserve">16 </t></r><rPh><t>x</t></rPh></si></sst>`,
      ),
      "xl/worksheets/data.xml": strToU8(
        `<x:worksheet><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="C1" t="b"><x:v>1</x:v></x:c></x:row>` +
          `<x:row r="2"><x:c r="A2" t="s"><x:v>1</x:v></x:c><x:c r="B2"><x:v>2015</x:v></x:c><x:c r="C2" t="e"><x:v>#N/A</x:v></x:c></x:row>` +
          `<x:row r="3"/></x:sheetData></x:worksheet>`,
      ),
    });
    expect(readSheet(file)).toEqual([
      ["رقم الأسطول", "", "TRUE"],
      ["T-16", "2015", ""],
    ]);
  });

  it("refuses a file that is not a workbook", () => {
    expect(() => readSheet(strToU8("name,phone\nx,1"))).toThrow(XlsxError);
  });
});

describe("writeSheet", () => {
  it("writes a template that reads back the same", () => {
    const rows = [
      ["الاسم *", "الهاتف", "الرصيد"],
      ["مثال: شركة <س> & ص", "0790000000", 1500.25],
    ];
    const back = readSheet(writeSheet(rows, { sheetName: "العملاء", rtl: true, widths: [30, 16, 14] }));
    expect(back).toEqual([
      ["الاسم *", "الهاتف", "الرصيد"],
      ["مثال: شركة <س> & ص", "0790000000", "1500.25"],
    ]);
  });
});

describe("helpers", () => {
  it("names columns and reads dates", () => {
    expect([columnName(0), columnName(25), columnName(26), columnName(701)]).toEqual(["A", "Z", "AA", "ZZ"]);
    expect(excelDate("46387")).toBe("2026-12-31");
    expect(excelDate("2027-03-05")).toBe("2027-03-05");
    expect(excelDate("5/3/2027")).toBe("2027-03-05");
    expect(excelDate("31-02-2027")).toBeNull();
    expect(excelDate("12")).toBeNull();
    expect(excelDate("")).toBeNull();
  });
});
