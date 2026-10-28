import type { AppRole } from "@/lib/roles";
import { ACCOUNT_TYPE, SUPPLIER_KIND } from "@/lib/labels";

// Master data screens are generated from this config: list columns, form
// fields, validation and who may edit. Records are deactivated, never deleted,
// so history and the audit trail stay intact.

export type FieldType = "text" | "int" | "decimal" | "date" | "select" | "ref" | "bool" | "money";

export type FieldDef = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  ref?: { table: RefTable; label: string; orderBy: string };
  hint?: string;
  ltr?: boolean;
};

export type RefTable = "trucks" | "accounts" | "drivers";

export type EntityKey = "trucks" | "drivers" | "clients" | "suppliers" | "locations" | "accounts" | "expense_categories";

export type EntityDef = {
  key: EntityKey | "truck_assets";
  table: EntityKey | "truck_assets";
  pk: "id" | "truck_id";
  title: string;
  singular: string;
  readRoles: AppRole[];
  writeRoles: AppRole[];
  orderBy: string;
  list: string[]; // field names shown as columns
  fields: FieldDef[];
};

const STAFF: AppRole[] = ["manager", "accountant", "dispatcher"];
const FINANCE: AppRole[] = ["manager", "accountant"];
const ACTIVE: FieldDef = { name: "is_active", label: "فعال", type: "bool" };
const NOTES: FieldDef = { name: "notes", label: "ملاحظات", type: "text" };

const toOptions = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

export const ENTITIES: Record<EntityKey, EntityDef> = {
  trucks: {
    key: "trucks",
    table: "trucks",
    pk: "id",
    title: "الشاحنات",
    singular: "شاحنة",
    readRoles: STAFF,
    writeRoles: STAFF,
    orderBy: "code",
    list: ["code", "plate_number", "make", "model", "year", "truck_type", "is_active"],
    fields: [
      { name: "code", label: "رقم الأسطول", type: "text", required: true, ltr: true, hint: "مثال: T-16" },
      { name: "plate_number", label: "رقم اللوحة", type: "text", required: true, ltr: true },
      { name: "make", label: "الصانع", type: "text", ltr: true },
      { name: "model", label: "الطراز", type: "text", ltr: true },
      { name: "year", label: "سنة الصنع", type: "int" },
      { name: "vin", label: "رقم الشاصي (VIN)", type: "text", ltr: true },
      { name: "truck_type", label: "النوع", type: "text" },
      { name: "expected_km_per_liter", label: "الاستهلاك المتوقع (كم/لتر)", type: "decimal", hint: "يُستخدم لتنبيه الاستهلاك غير الطبيعي" },
      { name: "fuel_tank_liters", label: "سعة الخزان (لتر)", type: "int" },
      ACTIVE,
      NOTES,
    ],
  },
  drivers: {
    key: "drivers",
    table: "drivers",
    pk: "id",
    title: "السائقون",
    singular: "سائق",
    readRoles: STAFF,
    writeRoles: STAFF,
    orderBy: "full_name",
    list: ["full_name", "phone", "license_number", "license_expiry", "default_truck_id", "is_active"],
    fields: [
      { name: "full_name", label: "الاسم الكامل", type: "text", required: true },
      { name: "phone", label: "الهاتف", type: "text", ltr: true },
      { name: "national_id", label: "الرقم الوطني", type: "text", ltr: true },
      { name: "license_number", label: "رقم رخصة القيادة", type: "text", ltr: true },
      { name: "license_expiry", label: "انتهاء الرخصة", type: "date" },
      { name: "default_truck_id", label: "الشاحنة المعتادة", type: "ref", ref: { table: "trucks", label: "code", orderBy: "code" } },
      { name: "hire_date", label: "تاريخ التعيين", type: "date" },
      ACTIVE,
      NOTES,
    ],
  },
  clients: {
    key: "clients",
    table: "clients",
    pk: "id",
    title: "العملاء",
    singular: "عميل",
    readRoles: STAFF,
    writeRoles: FINANCE,
    orderBy: "name",
    list: ["name", "ref_code", "city", "phone", "payment_terms_days", "default_currency", "is_active"],
    fields: [
      { name: "name", label: "الاسم", type: "text", required: true },
      {
        name: "ref_code",
        label: "رمز الإشارة",
        type: "text",
        ltr: true,
        hint: "2–6 أحرف إنجليزية أو أرقام، مثل ARB. تبدأ به أرقام الإشارة لنقلات هذا الزبون (ARB-0001)",
      },
      { name: "tax_number", label: "الرقم الضريبي", type: "text", ltr: true },
      { name: "vat_exempt", label: "معفى من ضريبة المبيعات", type: "bool", hint: "فواتيره بدون ضريبة" },
      { name: "phone", label: "الهاتف", type: "text", ltr: true },
      { name: "email", label: "البريد الإلكتروني", type: "text", ltr: true },
      { name: "city", label: "المدينة", type: "text" },
      { name: "address", label: "العنوان", type: "text" },
      { name: "payment_terms_days", label: "مدة السداد (يوم)", type: "int", required: true },
      { name: "credit_limit_base_minor", label: "سقف الائتمان (دينار)", type: "money" },
      {
        name: "default_currency",
        label: "العملة",
        type: "select",
        required: true,
        options: [
          { value: "JOD", label: "دينار أردني" },
          { value: "USD", label: "دولار أمريكي" },
        ],
      },
      ACTIVE,
      NOTES,
    ],
  },
  suppliers: {
    key: "suppliers",
    table: "suppliers",
    pk: "id",
    title: "الموردون",
    singular: "مورد",
    readRoles: STAFF,
    writeRoles: STAFF,
    orderBy: "name",
    list: ["name", "kind", "city", "phone", "is_active"],
    fields: [
      { name: "name", label: "الاسم", type: "text", required: true },
      { name: "kind", label: "النوع", type: "select", required: true, options: toOptions(SUPPLIER_KIND) },
      { name: "phone", label: "الهاتف", type: "text", ltr: true },
      { name: "tax_number", label: "الرقم الضريبي", type: "text", ltr: true },
      { name: "city", label: "المدينة", type: "text" },
      { name: "address", label: "العنوان", type: "text" },
      ACTIVE,
      NOTES,
    ],
  },
  locations: {
    key: "locations",
    table: "locations",
    pk: "id",
    title: "المواقع",
    singular: "موقع",
    readRoles: STAFF,
    writeRoles: STAFF,
    orderBy: "name",
    list: ["name", "country", "is_border_crossing", "is_active"],
    fields: [
      { name: "name", label: "الاسم", type: "text", required: true },
      { name: "country", label: "الدولة", type: "text", required: true },
      { name: "is_border_crossing", label: "مركز حدودي", type: "bool" },
      ACTIVE,
    ],
  },
  accounts: {
    key: "accounts",
    table: "accounts",
    pk: "id",
    title: "دليل الحسابات",
    singular: "حساب",
    readRoles: FINANCE,
    writeRoles: FINANCE,
    orderBy: "code",
    list: ["code", "name_ar", "type", "parent_id", "is_postable", "is_active"],
    fields: [
      { name: "code", label: "رمز الحساب", type: "text", required: true, ltr: true },
      { name: "name_ar", label: "اسم الحساب", type: "text", required: true },
      { name: "type", label: "النوع", type: "select", required: true, options: toOptions(ACCOUNT_TYPE) },
      { name: "parent_id", label: "الحساب الرئيسي", type: "ref", ref: { table: "accounts", label: "code", orderBy: "code" } },
      { name: "is_postable", label: "يقبل الترحيل", type: "bool", hint: "الحسابات الرئيسية لا تقبل قيوداً مباشرة" },
      ACTIVE,
    ],
  },
  expense_categories: {
    key: "expense_categories",
    table: "expense_categories",
    pk: "id",
    title: "أنواع المصاريف",
    singular: "نوع مصروف",
    readRoles: STAFF,
    writeRoles: FINANCE,
    orderBy: "sort_order",
    list: ["name_ar", "code", "account_id", "sort_order", "is_active"],
    fields: [
      { name: "name_ar", label: "الاسم", type: "text", required: true },
      { name: "code", label: "الرمز", type: "text", required: true, ltr: true, hint: "رمز ثابت بالإنجليزية، مثل tires" },
      {
        name: "account_id",
        label: "حساب المصروف",
        type: "ref",
        required: true,
        ref: { table: "accounts", label: "code", orderBy: "code" },
        hint: "الحساب الذي يُرحّل إليه هذا النوع لاحقاً",
      },
      { name: "sort_order", label: "الترتيب", type: "int" },
      ACTIVE,
    ],
  },
};

// Purchase values live in their own table so only finance roles can see them.
export const TRUCK_ASSETS: EntityDef = {
  key: "truck_assets",
  table: "truck_assets",
  pk: "truck_id",
  title: "قيمة الشاحنة",
  singular: "قيمة الشاحنة",
  readRoles: FINANCE,
  writeRoles: FINANCE,
  orderBy: "truck_id",
  list: [],
  fields: [
    { name: "purchase_date", label: "تاريخ الشراء", type: "date" },
    { name: "purchase_cost_base_minor", label: "كلفة الشراء (دينار)", type: "money", required: true },
    { name: "salvage_value_base_minor", label: "القيمة المتبقية (دينار)", type: "money", required: true },
    { name: "useful_life_months", label: "العمر الإنتاجي (شهر)", type: "int" },
  ],
};

export function getEntity(key: string): EntityDef | null {
  return (ENTITIES as Record<string, EntityDef>)[key] ?? null;
}

export function fieldLabel(entity: EntityDef, name: string): string {
  return entity.fields.find((f) => f.name === name)?.label ?? name;
}
