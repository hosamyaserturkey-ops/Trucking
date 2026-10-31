import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { formatPct, marginPct } from "@/lib/reports";

/** An amount in whole dinars on screen; the exact dinars (3 decimals) go to the Excel export. */
export function Jod({ minor, strong = false, tone = false }: { minor: number; strong?: boolean; tone?: boolean }) {
  const color = tone ? (minor < 0 ? "text-danger" : minor > 0 ? "text-success" : "") : "";
  return (
    <span className={`num whitespace-nowrap ${strong ? "font-semibold" : ""} ${color}`} data-x={(minor / 1000).toFixed(3)}>
      {formatMoney(minor, "JOD", { fractionDigits: 0, withCurrency: false })}
    </span>
  );
}

/** Profit as a share of revenue. */
export function Margin({ profit, revenue }: { profit: number; revenue: number }) {
  const pct = marginPct(profit, revenue);
  return (
    <span className={`num whitespace-nowrap ${pct === null ? "text-muted" : pct < 0 ? "text-danger" : ""}`} data-x={pct ?? ""}>
      {formatPct(pct)}
    </span>
  );
}

/** Tabs between the truck and the customer report, keeping the period. */
export function ReportTabs({ active, query }: { active: "trucks" | "clients"; query: string }) {
  const tab = (key: "trucks" | "clients", label: string) => (
    <Link
      href={`/reports/${key}${query ? `?${query}` : ""}`}
      aria-current={active === key ? "page" : undefined}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${active === key ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2 hover:text-text"}`}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="التقارير" className="flex gap-1 print:hidden">
      {tab("trucks", "ربح الشاحنات")}
      {tab("clients", "ربح الزبائن")}
    </nav>
  );
}
