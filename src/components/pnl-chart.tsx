"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type PnlPoint = {
  month: string; // YYYY-MM-01
  label: string;
  revenue: number; // JOD (display only; amounts are summed in fils on the server)
  costs: number;
  profit: number;
};

const SERIES = [
  { key: "revenue", label: "الإيرادات", color: "var(--chart-revenue)" },
  { key: "costs", label: "التكاليف", color: "var(--chart-cost)" },
  { key: "profit", label: "صافي الربح", color: "var(--chart-profit)" },
] as const;

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

type TooltipProps = { active?: boolean; payload?: { payload: PnlPoint }[] };

function ChartTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div dir="rtl" className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-semibold">{point.label}</p>
      {SERIES.map((s) => (
        <p key={s.key} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            {s.label}
          </span>
          <span className="num font-medium text-text">{full.format(point[s.key])} د.أ</span>
        </p>
      ))}
    </div>
  );
}

export function PnlChart({ data }: { data: PnlPoint[] }) {
  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="sr-only">الإيرادات والتكاليف وصافي الربح شهرياً بالدينار</figcaption>
      <ul className="flex flex-wrap gap-4 text-xs text-muted" aria-label="مفتاح الرسم">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            {s.key === "profit" ? (
              <span className="h-0.5 w-4 rounded" style={{ background: s.color }} aria-hidden />
            ) : (
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            )}
            {s.label}
          </li>
        ))}
      </ul>
      {/* The SVG is laid out LTR; the x-axis is reversed so months read right-to-left. */}
      <div dir="ltr" className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="label"
              reversed
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tick={{ fill: "var(--muted)", fontSize: 12 }}
            />
            <YAxis
              orientation="right"
              width={48}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              tickFormatter={(v: number) => compact.format(v)}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-2)" }} />
            <Bar dataKey="revenue" name="الإيرادات" fill="var(--chart-revenue)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            <Bar dataKey="costs" name="التكاليف" fill="var(--chart-cost)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            <Line
              dataKey="profit"
              name="صافي الربح"
              type="monotone"
              stroke="var(--chart-profit)"
              strokeWidth={2}
              dot={{ r: 4, fill: "var(--chart-profit)", stroke: "var(--surface)", strokeWidth: 2 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
