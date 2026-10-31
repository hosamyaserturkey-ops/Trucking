// Pure helpers for the truck and customer profit reports. Amounts are JOD fils.

export const PROFIT_BASES = {
  revenue: "حسب الإيراد",
  loads: "حسب عدد النقلات",
  km: "حسب الكيلومترات",
} as const;

export type ProfitBasis = keyof typeof PROFIT_BASES;

/** The allocation basis from the URL; revenue unless another known one is asked for. */
export function parseBasis(raw: string | undefined | null): ProfitBasis {
  return raw && Object.hasOwn(PROFIT_BASES, raw) ? (raw as ProfitBasis) : "revenue";
}

/** Profit as a whole percentage of revenue, or null with no revenue. */
export function marginPct(profit: number, revenue: number): number | null {
  if (!revenue) return null;
  const pct = (profit / revenue) * 100;
  return Math.round(pct * 10) / 10;
}

export function formatPct(pct: number | null): string {
  if (pct === null) return "—";
  return `${pct.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

/** Sum the numeric fields of report rows (for the totals line). */
export function sumRows<K extends string>(rows: Record<K, number | null>[], keys: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = 0;
  for (const r of rows) for (const k of keys) out[k] += Number(r[k] ?? 0);
  return out;
}

/** Fils per km (rounded), or null without km. */
export function perKm(minor: number, km: number): number | null {
  if (!km) return null;
  return Math.round(minor / km);
}

export type ClientReportRow = {
  client_id: string | null;
  is_idle: boolean;
  loads: number;
  revenue_minor: number;
  direct_minor: number;
  allocated_minor: number;
  profit_minor: number;
};

/**
 * Order the customer lines: customers by profit (best first), then loads with
 * no customer, then idle trucks' costs last.
 */
export function orderClientRows<T extends ClientReportRow>(rows: T[]): T[] {
  const rank = (r: T) => (r.is_idle ? 2 : r.client_id ? 0 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || b.profit_minor - a.profit_minor);
}
