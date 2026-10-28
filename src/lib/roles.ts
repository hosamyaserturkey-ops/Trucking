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

export type NavItem = { href: string; label: string; icon: string; roles: AppRole[] };

// Order is the order shown in the sidebar.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "الأسطول", icon: "truck", roles: STAFF_ROLES },
  { href: "/loading", label: "كشف التحميل", icon: "clipboard", roles: STAFF_ROLES },
  { href: "/trips", label: "الرحلات", icon: "route", roles: STAFF_ROLES },
  { href: "/approvals", label: "الموافقات", icon: "check", roles: FINANCE_ROLES },
  { href: "/advances", label: "العهد", icon: "wallet", roles: STAFF_ROLES },
  { href: "/diesel", label: "الديزل", icon: "fuel", roles: STAFF_ROLES },
  { href: "/expenses", label: "المصاريف", icon: "receipt", roles: STAFF_ROLES },
  { href: "/customs", label: "البيانات الجمركية", icon: "stamp", roles: STAFF_ROLES },
  { href: "/invoices", label: "الفواتير", icon: "invoice", roles: FINANCE_ROLES },
  { href: "/receipts", label: "المقبوضات", icon: "banknote", roles: FINANCE_ROLES },
  { href: "/receivables", label: "ذمم العملاء", icon: "handcoins", roles: FINANCE_ROLES },
  { href: "/ledger", label: "كشف الحسابات", icon: "scale", roles: FINANCE_ROLES },
  { href: "/journal", label: "دفتر اليومية", icon: "journal", roles: FINANCE_ROLES },
  { href: "/my", label: "رحلاتي", icon: "route", roles: ["driver"] },
  { href: "/master/trucks", label: "الشاحنات", icon: "list", roles: STAFF_ROLES },
  { href: "/master/drivers", label: "السائقون", icon: "users", roles: STAFF_ROLES },
  { href: "/master/clients", label: "العملاء", icon: "building", roles: STAFF_ROLES },
  { href: "/master/suppliers", label: "الموردون", icon: "store", roles: STAFF_ROLES },
  { href: "/master/locations", label: "المواقع", icon: "map", roles: STAFF_ROLES },
  { href: "/master/accounts", label: "دليل الحسابات", icon: "book", roles: FINANCE_ROLES },
  { href: "/master/expense_categories", label: "أنواع المصاريف", icon: "list", roles: FINANCE_ROLES },
  { href: "/settings/users", label: "المستخدمون", icon: "shield", roles: ["manager"] },
  { href: "/settings/company", label: "بيانات الشركة", icon: "settings", roles: ["manager"] },
  { href: "/audit", label: "سجل التدقيق", icon: "history", roles: ["manager"] },
];

export function navFor(role: AppRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export function homeFor(role: AppRole): string {
  return role === "driver" ? "/my" : "/";
}
