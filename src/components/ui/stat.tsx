import { Children, Fragment, isValidElement, type ReactNode } from "react";
import type { Tone } from "@/lib/labels";

const VALUE_TONE: Record<Tone, string> = {
  neutral: "text-text",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
};

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="min-w-0 border-b border-e border-border px-4 py-3">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`num mt-0.5 truncate text-lg font-bold sm:text-xl ${VALUE_TONE[tone]}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs leading-relaxed text-muted">{hint}</p> : null}
    </div>
  );
}

/** Columns for a band of n numbers, so no row is left half empty on wide screens. */
const BAND_COLS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-3 xl:grid-cols-6",
  7: "lg:grid-cols-4",
  8: "lg:grid-cols-4",
};

/** How many numbers a band holds, looking inside fragments (<>…</>). */
function countCells(children: ReactNode): number {
  return Children.toArray(children).reduce<number>(
    (n, c) => n + (isValidElement<{ children?: ReactNode }>(c) && c.type === Fragment ? countCells(c.props.children) : 1),
    0,
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  const n = countCells(children);
  // One band divided by hairlines; the outer edge hides the last row's and column's rules.
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className={`-mb-px -me-px grid grid-cols-2 ${BAND_COLS[n] ?? "lg:grid-cols-4"}`}>{children}</div>
    </div>
  );
}
