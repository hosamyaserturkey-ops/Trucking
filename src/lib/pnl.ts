import { COST_KINDS } from "@/lib/labels";

export type PnlRow = { kind: string | null; amount_base_minor: number | null };

export type PnlTotals = {
  revenue: number;
  costs: number;
  profit: number;
  byKind: Record<string, number>;
};

/** Revenue, total cost and profit from (kind, amount) rows. Integer fils throughout. */
export function pnlTotals(rows: PnlRow[]): PnlTotals {
  const byKind: Record<string, number> = {};
  for (const row of rows) {
    if (!row.kind) continue;
    byKind[row.kind] = (byKind[row.kind] ?? 0) + (row.amount_base_minor ?? 0);
  }
  const revenue = byKind.revenue ?? 0;
  const costs = COST_KINDS.reduce((sum, kind) => sum + (byKind[kind] ?? 0), 0);
  return { revenue, costs, profit: revenue - costs, byKind };
}

/** Integer division rounded half away from zero; null when the divisor is zero. */
export function perUnit(totalMinor: number, units: number): number | null {
  if (!units) return null;
  const q = totalMinor / units;
  return q < 0 ? -Math.round(-q) : Math.round(q);
}
