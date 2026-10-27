import type { ReactNode } from "react";
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
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`num mt-1 truncate text-lg font-bold sm:text-xl ${VALUE_TONE[tone]}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}
