import { Suspense } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { canSeeFinancials, STAFF_ROLES } from "@/lib/roles";
import { getTruck } from "@/lib/truck";
import { formatInt } from "@/lib/format";
import { TRUCK_STATUS } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { TruckTabs } from "@/components/truck-tabs";
import { DateRangeFilter } from "@/components/date-range-filter";
import { PrintLink } from "@/components/print-link";

export default async function TruckLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const profile = await requireRole(...STAFF_ROLES);
  const { id } = await params;
  const truck = await getTruck(id);
  const status = TRUCK_STATUS[truck.status ?? "idle"] ?? TRUCK_STATUS.idle;
  const finance = canSeeFinancials(profile.role);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/" className="flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        الأسطول
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted">ملف الشاحنة</p>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold sm:text-2xl">
            <span className="num">{truck.code}</span>
            <span className="num text-base font-medium text-muted">{truck.plate_number}</span>
            <Badge tone={status.tone}>{status.label}</Badge>
          </h1>
          <p className="mt-1 text-sm text-muted">
            {[truck.make, truck.model, truck.year].filter(Boolean).join(" ")}
            {truck.truck_type ? ` · ${truck.truck_type}` : ""}
            {" · السائق: "}
            {truck.current_driver_name ?? "—"}
            {" · العداد: "}
            <span className="num">{formatInt(truck.odometer)}</span> كم
          </p>
        </div>
        {finance ? (
          <Suspense>
            <PrintLink truckId={id} />
          </Suspense>
        ) : null}
      </header>

      <Suspense>
        <DateRangeFilter />
      </Suspense>
      <Suspense>
        <TruckTabs truckId={id} showFinancials={finance} />
      </Suspense>

      <div className="flex flex-col gap-5">{children}</div>
    </div>
  );
}
