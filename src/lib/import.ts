import { ENTITIES, type EntityKey } from "@/lib/master-data";
import { parseEntityForm } from "@/lib/master-data-parse";
import { SUPPLIER_KIND } from "@/lib/labels";
import { parseMoney, toLatinDigits } from "@/lib/money";
import { parseTruckLicence, type TruckLicence } from "@/lib/licence";
import { signedOpening, type OpeningAmount } from "@/lib/opening";
import { excelDate } from "@/lib/xlsx";

// Importing trucks, drivers, customers and suppliers from an Excel sheet:
// the template's columns, and each row checked with the same rules as the
// forms. Pure: used in the browser (template) and on the server (checks).

export type ImportType = "trucks" | "drivers" | "clients" | "suppliers";
export const IMPORT_TYPES: ImportType[] = ["trucks", "drivers", "clients", "suppliers"];

export type ImportColumn = { key: string; header: string; required?: boolean; example: string | number; width: number };

export const IMPORT_DEFS: Record<ImportType, { title: string; columns: ImportColumn[] }> = {
  trucks: {
    title: "الشاحنات",
    columns: [
      { key: "code", header: "رقم الأسطول", required: true, example: "T-01", width: 14 },
      { key: "plate_number", header: "رقم اللوحة", required: true, example: "52-11462", width: 14 },
      { key: "make", header: "الصانع", example: "Mercedes", width: 14 },
      { key: "model", header: "الطراز", example: "Actros", width: 14 },
      { key: "year", header: "سنة الصنع", example: 2019, width: 11 },
      { key: "vin", header: "رقم الشاصي", example: "WDB9634031L123456", width: 22 },
      { key: "truck_type", header: "النوع", example: "رأس قاطرة", width: 14 },
      { key: "expected_km_per_liter", header: "الاستهلاك المتوقع (كم/لتر)", example: 2.8, width: 16 },
      { key: "fuel_tank_liters", header: "سعة الخزان (لتر)", example: 600, width: 14 },
      { key: "licence_number", header: "رقم رخصة الشاحنة", example: "LIC-2026-001", width: 18 },
      { key: "licence_expiry", header: "انتهاء رخصة الشاحنة", example: "2027-03-31", width: 16 },
      { key: "notes", header: "ملاحظات", example: "", width: 24 },
    ],
  },
  drivers: {
    title: "السائقون",
    columns: [
      { key: "full_name", header: "الاسم الكامل", required: true, example: "محمد أحمد", width: 24 },
      { key: "phone", header: "الهاتف", example: "0790000000", width: 14 },
      { key: "national_id", header: "الرقم الوطني", example: "9861000000", width: 14 },
      { key: "license_number", header: "رقم رخصة القيادة", example: "DL-400100", width: 16 },
      { key: "license_expiry", header: "انتهاء رخصة القيادة", example: "2027-06-30", width: 16 },
      { key: "default_truck", header: "رقم أسطول الشاحنة المعتادة", example: "T-01", width: 16 },
      { key: "hire_date", header: "تاريخ التعيين", example: "2024-01-15", width: 14 },
      { key: "opening_advance", header: "العهدة المفتوحة معه (دينار)", example: 0, width: 16 },
      { key: "notes", header: "ملاحظات", example: "", width: 24 },
    ],
  },
  clients: {
    title: "العملاء",
    columns: [
      { key: "name", header: "الاسم", required: true, example: "شركة الأفق للتجارة", width: 28 },
      { key: "ref_code", header: "رمز الإشارة", example: "AFQ", width: 12 },
      { key: "tax_number", header: "الرقم الضريبي", example: "", width: 14 },
      { key: "vat_exempt", header: "معفى من الضريبة (نعم/لا)", example: "لا", width: 14 },
      { key: "phone", header: "الهاتف", example: "065000000", width: 14 },
      { key: "email", header: "البريد الإلكتروني", example: "", width: 22 },
      { key: "city", header: "المدينة", example: "عمّان", width: 12 },
      { key: "address", header: "العنوان", example: "", width: 24 },
      { key: "payment_terms_days", header: "مدة السداد (يوم)", example: 30, width: 12 },
      { key: "credit_limit_base_minor", header: "سقف الائتمان (دينار)", example: "", width: 14 },
      { key: "opening", header: "الرصيد الافتتاحي (موجب = عليه)", example: 0, width: 18 },
      { key: "notes", header: "ملاحظات", example: "", width: 24 },
    ],
  },
  suppliers: {
    title: "الموردون",
    columns: [
      { key: "name", header: "الاسم", required: true, example: "محطة وقود الشمال", width: 28 },
      { key: "kind", header: "النوع (محطة وقود/ورشة/قطع غيار/إطارات/أخرى)", required: true, example: "محطة وقود", width: 22 },
      { key: "phone", header: "الهاتف", example: "", width: 14 },
      { key: "tax_number", header: "الرقم الضريبي", example: "", width: 14 },
      { key: "city", header: "المدينة", example: "الزرقاء", width: 12 },
      { key: "address", header: "العنوان", example: "", width: 24 },
      { key: "opening", header: "الرصيد الافتتاحي (موجب = له)", example: 0, width: 18 },
      { key: "notes", header: "ملاحظات", example: "", width: 24 },
    ],
  },
};

/** The template: the header row (required columns marked *) and one example row. */
export function templateRows(type: ImportType): (string | number)[][] {
  const cols = IMPORT_DEFS[type].columns;
  return [
    cols.map((c) => (c.required ? `${c.header} *` : c.header)),
    cols.map((c, i) => (i === 0 ? `مثال: ${c.example}` : c.example)),
  ];
}

export type ImportRow = {
  /** Row number in the sheet (1 = header). */
  line: number;
  /** What identifies the record: fleet number, name, or national ID. */
  key: string;
  label: string;
  values: Record<string, unknown>;
  licence: TruckLicence | null;
  opening: OpeningAmount | null;
  openingAdvance: number | null;
  defaultTruck: string | null;
  error: string | null;
};

const norm = (s: string) => toLatinDigits(s).replace(/\*/g, "").replace(/\s+/g, " ").trim();

/** Excel's floating-point leftovers (12.300000000000001) back to what was typed. */
function cleanNumber(text: string): string {
  return /^-?\d+\.\d{6,}$/.test(text) ? String(Number(Number(text).toFixed(3))) : text;
}

/** A Jordanian mobile number Excel turned into a number (790000000 → 0790000000). */
function cleanPhone(text: string): string {
  return /^7\d{8}$/.test(text) ? `0${text}` : text;
}

const YES = ["نعم", "yes", "y", "true", "1", "✓", "x"];
const KIND_BY_LABEL: Record<string, string> = Object.fromEntries(Object.entries(SUPPLIER_KIND).map(([value, label]) => [label, value]));

/**
 * Check every row of an uploaded sheet: rows[0] is the header. Columns are
 * found by their header text, in any order; the template's example row and
 * empty rows are skipped.
 */
export function parseImport(type: ImportType, rows: string[][]): { error: string | null; rows: ImportRow[] } {
  const def = IMPORT_DEFS[type];
  const header = (rows[0] ?? []).map(norm);
  const index: Record<string, number> = {};
  for (const c of def.columns) {
    const i = header.indexOf(norm(c.header));
    if (i >= 0) index[c.key] = i;
  }
  const missing = def.columns.filter((c) => c.required && index[c.key] === undefined).map((c) => c.header);
  if (missing.length) return { error: `الأعمدة المطلوبة غير موجودة في الصف الأول: ${missing.join("، ")}. استخدم القالب.`, rows: [] };

  const entity = ENTITIES[type as EntityKey];
  const out: ImportRow[] = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((cells, n) => {
    const line = n + 2;
    const cell = (key: string) => (index[key] === undefined ? "" : cleanNumber(toLatinDigits(cells[index[key]] ?? "").trim()));
    if (def.columns.every((c) => !cell(c.key))) return;
    if (cell(def.columns[0].key).startsWith("مثال")) return;

    let error: string | null = null;
    const dateField = (key: string) => {
      const t = cell(key);
      if (!t) return "";
      const d = excelDate(t);
      if (!d) error ??= `تاريخ غير صحيح في «${def.columns.find((c) => c.key === key)?.header}»`;
      return d ?? "";
    };
    const get = (name: string): string | null => {
      switch (name) {
        case "is_active":
          return "on";
        case "default_currency":
          return "JOD";
        case "default_truck_id":
          return null; // resolved on the server from the fleet number
        case "vat_exempt":
          return YES.includes(cell(name).toLowerCase()) ? "on" : "";
        case "payment_terms_days":
          return cell(name) || "30";
        case "kind": {
          const t = cell(name);
          return KIND_BY_LABEL[t] ?? t;
        }
        case "phone":
          return cleanPhone(cell(name));
        case "license_expiry":
        case "hire_date":
          return dateField(name);
        case "credit_limit_base_minor":
        case "expected_km_per_liter":
          return cell(name).replace(/,/g, "");
        default:
          return cell(name);
      }
    };
    const parsed = parseEntityForm(entity.fields, get);
    if (!parsed.ok) error ??= parsed.error;
    const values = parsed.ok ? parsed.values : {};

    let licence: TruckLicence | null = null;
    if (type === "trucks") {
      const lc = parseTruckLicence((name) => (name === "licence_expiry" ? dateField(name) : cell(name)));
      if (!lc.ok) error ??= lc.error;
      else licence = lc.values;
    }
    let opening: OpeningAmount | null = null;
    if (type === "clients" || type === "suppliers") {
      const op = signedOpening(cell("opening"), type === "clients" ? "debit" : "credit");
      if (!op.ok) error ??= op.error;
      else opening = op.values;
    }
    let openingAdvance: number | null = null;
    if (type === "drivers" && cell("opening_advance")) {
      const amount = parseMoney(cell("opening_advance"), "JOD");
      if (amount === null || amount < 0n) error ??= "مبلغ العهدة المفتوحة غير صحيح";
      else if (amount > 0n) openingAdvance = Number(amount);
    }

    const label = cell(def.columns[0].key);
    const key = (type === "drivers" ? cell("national_id") || label : label).toLowerCase();
    if (key && seen.has(key)) error ??= "مكرر في نفس الملف";
    if (key) seen.add(key);

    out.push({
      line,
      key,
      label,
      values,
      licence,
      opening,
      openingAdvance,
      defaultTruck: type === "drivers" ? cell("default_truck") || null : null,
      error,
    });
  });
  return { error: out.length ? null : "لا توجد صفوف لاستيرادها في الملف", rows: out };
}
