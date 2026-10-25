import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, FileWarning, Wrench } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { canSeeFinancials, STAFF_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { resolveRange } from "@/lib/date-range";
import { pnlTotals } from "@/lib/pnl";
import { formatMoney } from "@/lib/money";
import { formatDate, formatInt } from "@/lib/format";
import { DOC_TYPE, EXPIRY_BAND, SERVICE_STATUS, TRUCK_STATUS } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";

export const metadata: Metadata = { title: "الأسطول" };

export default async function FleetPage() {
  const profile = await requireRole(...STAFF_ROLES);
  const finance = canSeeFinancials(profile.role);
  const month = resolveRange({ range: "month" });
  const supabase = await createClient();

  const [trucksRes, docsRes, servicesRes, pnlRes] = await Promise.all([
    supabase.from("truck_overview_v").select("*").order("code"),
    supabase
      .from("document_expiry_v")
      .select("id, truck_id, truck_code, doc_type, title, expiry_date, days_left, expiry_band")
      .in("expiry_band", ["expired", "d7", "d30"])
      .order("expiry_date"),
    supabase
      .from("service_due_v")
      .select("id, truck_id, service_name, km_left, days_left, due_status")
      .in("due_status", ["overdue", "due_soon"]),
    finance
      ? supabase.rpc("truck_pnl_summary", { p_from: month.from, p_to: month.to })
      : Promise.resolve({ data: [] as { truck_id: string; kind: string; amount_base_minor: number }[] }),
  ]);

  const trucks = trucksRes.data ?? [];
  const docs = docsRes.data ?? [];
  const services = servicesRes.data ?? [];
  const pnlRows = pnlRes.data ?? [];
  const codeById = new Map(trucks.map((t) => [t.truck_id, t.code]));

  const count = (status: string) => trucks.filter((t) => t.status === status).length;
  const fleetPnl = pnlTotals(pnlRows);
  const truckProfit = (id: string | null) => pnlTotals(pnlRows.filter((r) => r.truck_id === id)).profit;

  return (
    <>
      <PageHeader title="الأسطول" subtitle={`${trucks.length} شاحنة · ${month.label}`} />

      <StatGrid>
        <Stat label="في رحلة" value={formatInt(count("on_trip"))} tone="info" />
        <Stat label="متوقفة" value={formatInt(count("idle"))} />
        <Stat label="في الورشة" value={formatInt(count("workshop"))} tone={count("workshop") ? "warning" : "neutral"} />
        <Stat
          label="تنبيهات"
          value={formatInt(docs.length + services.length)}
          hint="وثائق وصيانة"
          tone={docs.length + services.length ? "danger" : "success"}
        />
        {finance ? (
          <>
            <Stat label="إيرادات الشهر" value={formatMoney(fleetPnl.revenue, "JOD", { fractionDigits: 0 })} />
            <Stat label="تكاليف الشهر" value={formatMoney(fleetPnl.costs, "JOD", { fractionDigits: 0 })} />
            <Stat
              label="صافي ربح الشهر"
              value={formatMoney(fleetPnl.profit, "JOD", { fractionDigits: 0 })}
              tone={fleetPnl.profit >= 0 ? "success" : "danger"}
            />
            <Stat
              label="هامش الربح"
              value={fleetPnl.revenue ? `${Math.round((fleetPnl.profit / fleetPnl.revenue) * 100)}%` : "—"}
            />
          </>
        ) : null}
      </StatGrid>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_22rem]">
        <section aria-label="الشاحنات">
          {trucks.length === 0 ? (
            <Card>
              <EmptyState>لا توجد شاحنات بعد.</EmptyState>
            </Card>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {trucks.map((t) => {
                const status = TRUCK_STATUS[t.status ?? "idle"] ?? TRUCK_STATUS.idle;
                const profit = finance ? truckProfit(t.truck_id) : null;
                return (
                  <li key={t.truck_id}>
                    <Link
                      href={`/trucks/${t.truck_id}`}
                      className="block rounded-xl border border-border bg-surface p-4 transition-colors hover:border-primary"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex items-baseline gap-2 font-bold">
                            <span className="num">{t.code}</span>
                            <span className="num text-sm font-medium text-muted">{t.plate_number}</span>
                          </p>
                          <p className="mt-0.5 truncate text-sm text-muted">
                            {[t.make, t.model, t.year].filter(Boolean).join(" ")}
                          </p>
                        </div>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                        <dt className="text-muted">السائق</dt>
                        <dd className="truncate">{t.current_driver_name ?? "—"}</dd>
                        <dt className="text-muted">العداد</dt>
                        <dd className="num text-start">{formatInt(t.odometer)} كم</dd>
                        {profit !== null ? (
                          <>
                            <dt className="text-muted">ربح الشهر</dt>
                            <dd className={`num text-start font-semibold ${profit >= 0 ? "text-success" : "text-danger"}`}>
                              {formatMoney(profit, "JOD", { fractionDigits: 0 })}
                            </dd>
                          </>
                        ) : null}
                      </dl>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <FileWarning className="size-4 text-danger" aria-hidden />
                  وثائق تنتهي قريباً
                </span>
              }
              subtitle="المنتهية أو خلال 30 يوماً"
            />
            {docs.length === 0 ? (
              <EmptyState>لا توجد وثائق تنتهي قريباً.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {docs.map((d) => {
                  const band = EXPIRY_BAND[d.expiry_band ?? "ok"];
                  return (
                    <li key={d.id}>
                      <Link
                        href={`/trucks/${d.truck_id}/documents`}
                        className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-surface-2"
                      >
                        <span className="min-w-0">
                          <span className="num font-semibold">{d.truck_code}</span> <span>{DOC_TYPE[d.doc_type ?? "other"]}</span>
                          <span className="block text-xs text-muted">{formatDate(d.expiry_date)}</span>
                        </span>
                        <Badge tone={band.tone}>
                          {(d.days_left ?? 0) < 0 ? band.label : `${d.days_left} يوم`}
                        </Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Wrench className="size-4 text-warning" aria-hidden />
                  صيانة مستحقة
                </span>
              }
            />
            {services.length === 0 ? (
              <EmptyState>لا توجد صيانة مستحقة.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {services.map((s) => {
                  const st = SERVICE_STATUS[s.due_status ?? "ok"];
                  return (
                    <li key={s.id}>
                      <Link
                        href={`/trucks/${s.truck_id}/maintenance`}
                        className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-surface-2"
                      >
                        <span className="min-w-0">
                          <span className="num font-semibold">{codeById.get(s.truck_id) ?? ""}</span> <span>{s.service_name}</span>
                          <span className="block text-xs text-muted">
                            {s.km_left !== null ? (
                              <>
                                متبقي <span className="num">{formatInt(s.km_left)}</span> كم
                              </>
                            ) : null}
                            {s.km_left !== null && s.days_left !== null ? " · " : null}
                            {s.days_left !== null ? (
                              <>
                                <span className="num">{formatInt(s.days_left)}</span> يوم
                              </>
                            ) : null}
                          </span>
                        </span>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {trucksRes.error ? (
            <p className="flex items-center gap-2 text-sm text-danger">
              <AlertTriangle className="size-4" aria-hidden />
              تعذر تحميل البيانات: {trucksRes.error.message}
            </p>
          ) : null}
        </aside>
      </div>
    </>
  );
}
