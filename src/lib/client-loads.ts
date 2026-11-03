import { toLatinDigits } from "@/lib/money";

// Pure helpers for a customer's loads on their statement: finding a load by
// its reference number, how far each invoice is paid, and loads claimed or not
// claimed per month.

/**
 * What the user typed in the reference search, as the references it may mean.
 * References look like ARB-0041 (the customer's code, a dash, four digits).
 * Arabic digits, lower case, spaces and a missing dash or leading zeros are
 * accepted: "arb 41", "ARB0041" and "ARB-٤١" all find ARB-0041.
 */
export function refCandidates(input: string): string[] {
  const text = toLatinDigits(input).toUpperCase().replace(/\s+/g, "").replace(/[–—_]/g, "-");
  if (!text) return [];
  const out = new Set<string>([text]);
  const pad = (prefix: string, digits: string) => `${prefix}-${String(Number(digits)).padStart(4, "0")}`;
  const dashed = /^([A-Z0-9]+)-(\d{1,9})$/.exec(text);
  if (dashed) out.add(pad(dashed[1], dashed[2]));
  // No dash: the code ends where its letters end (ARB0041 -> ARB-0041).
  const plain = /^([A-Z]+)(\d{1,9})$/.exec(text);
  if (plain) out.add(pad(plain[1], plain[2]));
  return [...out];
}

export type InvoicePayState = "paid" | "partial" | "unpaid";

export type InvoiceForPayment = { id: string; invoice_no: number; invoice_date: string; total_minor: number };

/**
 * How much of each invoice is paid, oldest invoice first, the same rule the
 * balance and the overdue amount use: what the customer paid goes first to his
 * opening balance, then to his invoices in date order. So what is still owed
 * on invoices is the newest part of his balance.
 *
 * `balance_minor` is the customer's balance now (positive: he owes us). A
 * cheque in hand counts as paid, as it does in the balance.
 */
export function invoicePayments<T extends InvoiceForPayment>(invoices: T[], balance_minor: number) {
  const sorted = [...invoices].sort((a, b) => a.invoice_date.localeCompare(b.invoice_date) || a.invoice_no - b.invoice_no);
  const invoiced = sorted.reduce((s, i) => s + i.total_minor, 0);
  let available = invoiced - Math.min(Math.max(balance_minor, 0), invoiced);
  const rows = sorted.map((i) => {
    const paid_minor = Math.min(available, i.total_minor);
    available -= paid_minor;
    const state: InvoicePayState = paid_minor === i.total_minor ? "paid" : paid_minor > 0 ? "partial" : "unpaid";
    return { ...i, paid_minor, remaining_minor: i.total_minor - paid_minor, state };
  });
  return new Map(rows.map((r) => [r.id, r]));
}

/** Invoices by how far they are paid: how many and how much (remaining for partly paid and unpaid). */
export function payStateTotals(rows: { state: InvoicePayState; total_minor: number; remaining_minor: number }[]) {
  const out: Record<InvoicePayState, { count: number; total_minor: number; remaining_minor: number }> = {
    paid: { count: 0, total_minor: 0, remaining_minor: 0 },
    partial: { count: 0, total_minor: 0, remaining_minor: 0 },
    unpaid: { count: 0, total_minor: 0, remaining_minor: 0 },
  };
  for (const r of rows) {
    out[r.state].count += 1;
    out[r.state].total_minor += r.total_minor;
    out[r.state].remaining_minor += r.remaining_minor;
  }
  return out;
}

export type MonthClaims = {
  /** YYYY-MM */
  month: string;
  claimed: { loads: number; amount_minor: number };
  unclaimed: { loads: number; amount_minor: number };
};

/** Loads per month of their load date: claimed (on an invoice) and not claimed yet, oldest month first. */
export function monthlyClaims(loads: { date: string; invoiced: boolean; amount_minor: number }[]): MonthClaims[] {
  const months = new Map<string, MonthClaims>();
  for (const l of loads) {
    const month = l.date.slice(0, 7);
    let m = months.get(month);
    if (!m) {
      m = { month, claimed: { loads: 0, amount_minor: 0 }, unclaimed: { loads: 0, amount_minor: 0 } };
      months.set(month, m);
    }
    const side = l.invoiced ? m.claimed : m.unclaimed;
    side.loads += 1;
    side.amount_minor += l.amount_minor;
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}
