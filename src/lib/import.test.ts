import { describe, expect, it } from "vitest";
import { IMPORT_DEFS, parseImport, templateRows } from "./import";
import { readSheet, writeSheet } from "./xlsx";

const header = (type: keyof typeof IMPORT_DEFS) => templateRows(type)[0].map(String);

describe("templateRows", () => {
  it("marks required columns and starts the example row with «مثال»", () => {
    const [head, example] = templateRows("clients");
    expect(head[0]).toBe("الاسم *");
    expect(String(example[0]).startsWith("مثال")).toBe(true);
  });
  it("round-trips through a real .xlsx and imports nothing from the example alone", () => {
    const rows = readSheet(writeSheet(templateRows("suppliers"), { sheetName: "الموردون", rtl: true }));
    expect(parseImport("suppliers", rows)).toEqual({ error: "لا توجد صفوف لاستيرادها في الملف", rows: [] });
  });
});

describe("parseImport", () => {
  it("needs the required columns, in any order", () => {
    expect(parseImport("trucks", [["رقم اللوحة"], ["1"]]).error).toContain("رقم الأسطول");
    const rows = parseImport("trucks", [["رقم اللوحة *", "رقم الأسطول *"], ["52-1", "T-99"]]).rows;
    expect(rows[0]).toMatchObject({ line: 2, key: "t-99", label: "T-99", error: null, values: { code: "T-99", plate_number: "52-1", is_active: true } });
  });

  it("reads customers: yes/no, default payment terms, signed opening balance, fixed phone numbers", () => {
    const h = header("clients");
    const at = (name: string) => h.findIndex((x) => x.startsWith(name));
    const row = (vals: Record<string, string>) => {
      const r = Array(h.length).fill("");
      for (const [k, v] of Object.entries(vals)) r[at(k)] = v;
      return r;
    };
    const { rows } = parseImport("clients", [
      h,
      row({ "الاسم": "شركة أ", "معفى": "نعم", "الهاتف": "790000001", "الرصيد": "1,250.5" }),
      row({ "الاسم": "شركة ب", "مدة السداد": "45", "الرصيد": "-200" }),
      row({ "الاسم": "شركة أ" }),
      [],
      row({ "الاسم": "شركة ج", "الرصيد": "abc" }),
    ]);
    expect(rows[0]).toMatchObject({
      line: 2,
      error: null,
      values: { name: "شركة أ", vat_exempt: true, phone: "0790000001", payment_terms_days: 30, default_currency: "JOD" },
      opening: { debit_minor: 1_250_500, credit_minor: 0 },
    });
    expect(rows[1]).toMatchObject({ values: { payment_terms_days: 45, vat_exempt: false }, opening: { debit_minor: 0, credit_minor: 200_000 } });
    expect(rows[2]).toMatchObject({ line: 4, error: "مكرر في نفس الملف" });
    expect(rows[3]).toMatchObject({ line: 6, error: "الرصيد الافتتاحي غير صحيح" });
  });

  it("reads suppliers by their kind's Arabic name; an unknown kind is refused", () => {
    const h = header("suppliers");
    const { rows } = parseImport("suppliers", [h, ["محطة الجنوب", "محطة وقود", "", "", "", "", "300"], ["ورشة النور", "مطعم"]]);
    expect(rows[0]).toMatchObject({ error: null, values: { kind: "fuel_station" }, opening: { debit_minor: 0, credit_minor: 300_000 } });
    expect(rows[1].error).toBe("قيمة غير مسموحة في «النوع»");
  });

  it("reads drivers: Excel dates, the usual truck, the advance they hold; keyed by national ID", () => {
    const h = header("drivers");
    const { rows } = parseImport("drivers", [
      h,
      ["سائق أ", "", "9861000001", "DL-1", "46387", "T-03", "15/01/2024", "120.5", ""],
      ["سائق ب", "", "", "", "31/02/2027"],
    ]);
    expect(rows[0]).toMatchObject({
      key: "9861000001",
      error: null,
      values: { license_expiry: "2026-12-31", hire_date: "2024-01-15", default_truck_id: null },
      defaultTruck: "T-03",
      openingAdvance: 120_500,
    });
    expect(rows[1]).toMatchObject({ key: "سائق ب", error: "تاريخ غير صحيح في «انتهاء رخصة القيادة»" });
  });

  it("reads a truck's licence number and expiry", () => {
    const h = header("trucks");
    const r = Array(h.length).fill("");
    r[0] = "T-50";
    r[1] = "10-1";
    r[h.indexOf("رقم رخصة الشاحنة")] = "LIC-9";
    r[h.indexOf("انتهاء رخصة الشاحنة")] = "2027-03-31";
    r[h.indexOf("الاستهلاك المتوقع (كم/لتر)")] = "2.8000000000000003";
    const { rows } = parseImport("trucks", [h, r]);
    expect(rows[0]).toMatchObject({ error: null, licence: { doc_number: "LIC-9", expiry_date: "2027-03-31" }, values: { expected_km_per_liter: "2.8" } });
  });
});
