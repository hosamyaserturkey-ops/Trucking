import { todayIso } from "@/lib/date-range";

// Pure helpers for the journal and account statements (كشف حساب). Amounts are
// JOD fils; a balance is debit minus credit.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Where an automatic entry comes from. */
export const JOURNAL_SOURCE: Record<string, string> = {
  expense: "مصروف",
  fuel: "ديزل",
  advance: "عهدة",
  settlement: "تسوية عهدة",
  invoice: "فاتورة",
  receipt: "سند قبض",
  cheque: "شيك",
  supplier_payment: "دفعة مورد",
  issued_cheque: "شيك صادر",
  depreciation: "استهلاك",
};

export function sourceLabel(sourceType: string | null | undefined): string {
  return sourceType ? (JOURNAL_SOURCE[sourceType] ?? sourceType) : "قيد يدوي";
}

/** The page of the document behind an entry, when there is one to open. */
export function sourceHref(sourceType: string | null | undefined, sourceId: string | null | undefined): string | null {
  if (!sourceId) return null;
  if (sourceType === "expense") return `/expenses/${sourceId}/edit`;
  if (sourceType === "fuel") return `/diesel/${sourceId}/edit`;
  if (sourceType === "settlement") return `/print/settlements/${sourceId}`;
  if (sourceType === "invoice") return `/invoices/${sourceId}`;
  if (sourceType === "receipt" || sourceType === "cheque") return `/print/receipts/${sourceId}`;
  if (sourceType === "supplier_payment" || sourceType === "issued_cheque") return `/print/payments/${sourceId}`;
  return null;
}

export type StatementFilter = {
  from: string; // inclusive
  to: string; // inclusive
  truck: string;
  supplier: string;
  driver: string;
  client: string;
};

/** Read a statement's filters from the URL; the period defaults to this month so far. */
export function statementFilter(
  sp: { from?: string; to?: string; truck?: string; supplier?: string; driver?: string; client?: string },
  today: string = todayIso(),
): StatementFilter {
  let from = `${today.slice(0, 8)}01`;
  let to = today;
  if (sp.from && sp.to && ISO_DATE.test(sp.from) && ISO_DATE.test(sp.to)) {
    [from, to] = sp.from <= sp.to ? [sp.from, sp.to] : [sp.to, sp.from];
  }
  const id = (v: string | undefined) => (v && UUID.test(v) ? v : "");
  return { from, to, truck: id(sp.truck), supplier: id(sp.supplier), driver: id(sp.driver), client: id(sp.client) };
}

/** The same filters as a query string, to keep them across links (print, accounts). */
export function filterQuery(f: StatementFilter): string {
  const q = new URLSearchParams({ from: f.from, to: f.to });
  if (f.truck) q.set("truck", f.truck);
  if (f.supplier) q.set("supplier", f.supplier);
  if (f.driver) q.set("driver", f.driver);
  if (f.client) q.set("client", f.client);
  return q.toString();
}

/** Each line with the balance after it, starting from the opening balance. */
export function withRunningBalance<T extends { debit_minor: number; credit_minor: number }>(
  opening: number,
  lines: T[],
): (T & { balance_minor: number })[] {
  let balance = opening;
  return lines.map((l) => {
    balance += l.debit_minor - l.credit_minor;
    return { ...l, balance_minor: balance };
  });
}

/** A balance as an amount and its side: مدين (debit) or دائن (credit). */
export function balanceSide(minor: number): { minor: number; side: "مدين" | "دائن" | "" } {
  if (minor === 0) return { minor: 0, side: "" };
  return minor > 0 ? { minor, side: "مدين" } : { minor: -minor, side: "دائن" };
}

type Account = { id: string; parent_id: string | null; is_postable: boolean; type: string };

/**
 * The postable accounts a statement covers: the account itself, or every
 * postable account under a parent account; "expenses" means every expense account.
 */
export function statementAccounts(key: string, accounts: Account[]): string[] {
  if (key === "expenses") return accounts.filter((a) => a.type === "expense" && a.is_postable).map((a) => a.id);
  const root = accounts.find((a) => a.id === key);
  if (!root) return [];
  const out: string[] = [];
  const walk = (id: string) => {
    for (const a of accounts) if (a.parent_id === id) {
      if (a.is_postable) out.push(a.id);
      walk(a.id);
    }
  };
  if (root.is_postable) out.push(root.id);
  walk(root.id);
  return out;
}
