import { formatMoney } from "@/lib/money";

/** Advance balance in JOD. Positive: the driver still holds company cash. Negative: the company owes the driver. */
export function BalanceText({ minor }: { minor: number }) {
  if (minor === 0) return <span className="num">0</span>;
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className={`num ${minor > 0 ? "" : "text-success"}`}>{formatMoney(Math.abs(minor), "JOD")}</span>
      <span className="text-xs font-normal text-muted">{minor > 0 ? "على السائق" : "للسائق"}</span>
    </span>
  );
}
