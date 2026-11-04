import type { Database } from "@/types/database";

export type AppRole = Database["public"]["Enums"]["app_role"];

export const ROLE_LABELS: Record<AppRole, string> = {
  manager: "مدير",
  accountant: "محاسب",
  dispatcher: "منسق حركة",
  driver: "سائق",
};

export const STAFF_ROLES: AppRole[] = ["manager", "accountant", "dispatcher"];
export const FINANCE_ROLES: AppRole[] = ["manager", "accountant"];
export const MASTER_DATA_WRITERS: AppRole[] = ["manager", "accountant"];
export const TRIP_WRITERS: AppRole[] = ["manager", "dispatcher"];
// Fill-ups: a dispatcher's entries go to approval (the database enforces it).
export const FUEL_WRITERS: AppRole[] = ["manager", "accountant", "dispatcher"];

export function canSeeFinancials(role: AppRole | null | undefined): boolean {
  return !!role && FINANCE_ROLES.includes(role);
}

export type NavGroup = "daily" | "operations" | "customers" | "suppliers" | "accounts" | "master" | "admin";

export type NavItem = { href: string; label: string; icon: string; roles: AppRole[]; group: NavGroup };

/** Menu sections, in order. `folded`: closed unless the current page is in it. */
export const NAV_GROUPS: { key: NavGroup; label: string; folded?: boolean }[] = [
  { key: "daily", label: "العمل اليومي" },
  { key: "operations", label: "التشغيل والسائقون" },
  { key: "customers", label: "الزبائن" },
  { key: "suppliers", label: "الموردون والبنوك" },
  { key: "accounts", label: "الحسابات" },
  { key: "master", label: "البيانات الأساسية", folded: true },
  { key: "admin", label: "الإدارة", folded: true },
];

// Order within a section is the order shown in the sidebar.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "الأسطول", icon: "truck", roles: STAFF_ROLES, group: "daily" },
  { href: "/loading", label: "كشف التحميل", icon: "clipboard", roles: STAFF_ROLES, group: "daily" },
  { href: "/trips", label: "الرحلات", icon: "route", roles: STAFF_ROLES, group: "daily" },
  { href: "/approvals", label: "الموافقات", icon: "check", roles: FINANCE_ROLES, group: "daily" },
  { href: "/advances", label: "العهد وحسابات السائقين", icon: "wallet", roles: STAFF_ROLES, group: "operations" },
  { href: "/diesel", label: "الديزل", icon: "fuel", roles: STAFF_ROLES, group: "operations" },
  { href: "/expenses", label: "المصاريف", icon: "receipt", roles: STAFF_ROLES, group: "operations" },
  { href: "/maintenance", label: "الصيانة", icon: "wrench", roles: STAFF_ROLES, group: "operations" },
  { href: "/customs", label: "البيانات الجمركية", icon: "stamp", roles: STAFF_ROLES, group: "operations" },
  { href: "/invoices", label: "الفواتير", icon: "invoice", roles: FINANCE_ROLES, group: "customers" },
  { href: "/receipts", label: "المقبوضات", icon: "banknote", roles: FINANCE_ROLES, group: "customers" },
  { href: "/receivables", label: "ذمم العملاء", icon: "handcoins", roles: FINANCE_ROLES, group: "customers" },
  { href: "/payments", label: "دفعات الموردين", icon: "send", roles: FINANCE_ROLES, group: "suppliers" },
  { href: "/payables", label: "ذمم الموردين", icon: "landmark", roles: FINANCE_ROLES, group: "suppliers" },
  { href: "/banks", label: "الحسابات البنكية", icon: "vault", roles: FINANCE_ROLES, group: "suppliers" },
  { href: "/bank", label: "مطابقة البنك", icon: "bankcheck", roles: FINANCE_ROLES, group: "suppliers" },
  { href: "/reports", label: "تقارير الربح", icon: "chart", roles: FINANCE_ROLES, group: "accounts" },
  { href: "/ledger", label: "كشف الحسابات", icon: "scale", roles: FINANCE_ROLES, group: "accounts" },
  { href: "/journal", label: "دفتر اليومية", icon: "journal", roles: FINANCE_ROLES, group: "accounts" },
  { href: "/opening", label: "الأرصدة الافتتاحية", icon: "flag", roles: FINANCE_ROLES, group: "accounts" },
  { href: "/import", label: "استيراد من Excel", icon: "spreadsheet", roles: FINANCE_ROLES, group: "accounts" },
  { href: "/my", label: "رحلاتي", icon: "route", roles: ["driver"], group: "daily" },
  { href: "/master/trucks", label: "الشاحنات", icon: "list", roles: STAFF_ROLES, group: "master" },
  { href: "/master/drivers", label: "السائقون", icon: "users", roles: STAFF_ROLES, group: "master" },
  { href: "/master/clients", label: "العملاء", icon: "building", roles: STAFF_ROLES, group: "master" },
  { href: "/master/suppliers", label: "الموردون", icon: "store", roles: STAFF_ROLES, group: "master" },
  { href: "/master/locations", label: "المواقع", icon: "map", roles: STAFF_ROLES, group: "master" },
  { href: "/master/accounts", label: "دليل الحسابات", icon: "book", roles: FINANCE_ROLES, group: "master" },
  { href: "/master/expense_categories", label: "أنواع المصاريف", icon: "list", roles: FINANCE_ROLES, group: "master" },
  { href: "/settings/users", label: "المستخدمون", icon: "shield", roles: ["manager"], group: "admin" },
  { href: "/settings/company", label: "بيانات الشركة", icon: "settings", roles: ["manager"], group: "admin" },
  { href: "/audit", label: "سجل التدقيق", icon: "history", roles: ["manager"], group: "admin" },
];

export function navFor(role: AppRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export function homeFor(role: AppRole): string {
  return role === "driver" ? "/my" : "/";
}
