"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { inclusiveEnd, resolveRange } from "@/lib/date-range";
import { buttonClass } from "@/components/ui/button";

/** `keep` names other query parameters (e.g. a report's basis) to carry across range changes. */
export function DateRangeFilter({ keep = [] }: { keep?: string[] } = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const extra = keep
    .map((k) => [k, params.get(k)] as const)
    .filter(([, v]) => v)
    .map(([k, v]) => `&${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
    .join("");
  const range = resolveRange({
    range: params.get("range") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  });
  const chip = (key: "month" | "year", label: string) => (
    <Link
      href={`${pathname}?range=${key}${extra}`}
      aria-current={range.key === key ? "true" : undefined}
      className={buttonClass(range.key === key ? "primary" : "secondary", "py-1.5")}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chip("month", "هذا الشهر")}
      {chip("year", "هذه السنة")}
      {/* Keyed so the inputs reset whenever the range in the URL changes. */}
      <CustomRange
        key={params.toString()}
        initialFrom={range.from}
        initialTo={inclusiveEnd(range)}
        active={range.key === "custom"}
        onApply={(from, to) => router.push(`${pathname}?range=custom&from=${from}&to=${to}${extra}`)}
      />
    </div>
  );
}

function CustomRange({
  initialFrom,
  initialTo,
  active,
  onApply,
}: {
  initialFrom: string;
  initialTo: string;
  active: boolean;
  onApply: (from: string, to: string) => void;
}) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(from, to);
      }}
    >
        <label htmlFor="range-from" className="text-sm text-muted">
          من
        </label>
        <input
          id="range-from"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
          required
        />
        <label htmlFor="range-to" className="text-sm text-muted">
          إلى
        </label>
        <input
          id="range-to"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
          required
        />
      <button type="submit" className={buttonClass(active ? "primary" : "secondary", "py-1.5")}>
        تطبيق
      </button>
    </form>
  );
}
