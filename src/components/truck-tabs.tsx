"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const TABS = [
  { slug: "", label: "نظرة عامة" },
  { slug: "trips", label: "الرحلات" },
  { slug: "diesel", label: "الديزل" },
  { slug: "maintenance", label: "الصيانة" },
  { slug: "documents", label: "الوثائق" },
  { slug: "expenses", label: "المصاريف" },
  { slug: "financials", label: "المالية", financeOnly: true },
];

export function TruckTabs({ truckId, showFinancials }: { truckId: string; showFinancials: boolean }) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const base = `/trucks/${truckId}`;

  return (
    <nav aria-label="أقسام ملف الشاحنة" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {TABS.filter((t) => showFinancials || !t.financeOnly).map((tab) => {
          const href = tab.slug ? `${base}/${tab.slug}` : base;
          const active = pathname === href;
          return (
            <li key={tab.slug}>
              <Link
                href={query ? `${href}?${query}` : href}
                aria-current={active ? "page" : undefined}
                className={`-mb-px block whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted hover:border-border hover:text-text"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
