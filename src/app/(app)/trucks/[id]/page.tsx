import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { canSeeFinancials, STAFF_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { truckPage, tripInRange, type TruckPageProps } from "@/lib/truck";
import { perUnit, pnlTotals } from "@/lib/pnl";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDecimal, formatInt } from "@/lib/format";
import { COST_KINDS, DOC_TYPE, EXPIRY_BAND, PNL_KIND, SERVICE_STATUS } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";

export default async function TruckOverviewPage(props: TruckPageProps) {
  const profile = await requireRole(...STAFF_ROLES);
  const { id, range } = await truckPage(props);
  const finance = canSeeFinancials(profile.role);
  const supabase = await createClient();

  const [tripsRes, fuelRes, servicesRes, docsRes, pnlRes] = await Promise.all([
    supabase
      .from("trip_profit_v")
      .select("trip_id, status, distance_km, is_empty_return")
      .eq("truck_id", id)
      .in("status", ["in_progress", "completed"])
      .or(tripInRange(range)),
    supabase
      .from("fuel_efficiency_v")
      .select("liters, km_since_last_full, km_per_liter, is_abnormal")
      .eq("truck_id", id)
      .gte("filled_on", range.from)
      .lt("filled_on", range.to),
    supabase.from("service_due_v").select("*").eq("truck_id", id).order("service_name"),
    supabase
      .from("document_expiry_v")
      .select("id, doc_type, expiry_date, days_left, expiry_band")
      .eq("truck_id", id)
      .order("expiry_date")
      .limit(4),
    finance
      ? supabase.rpc("truck_pnl_summary", { p_from: range.from, p_to: range.to, p_truck_id: id })
      : Promise.resolve({ data: [] as { kind: string; amount_base_minor: number }[] }),
  ]);

  const trips = tripsRes.data ?? [];
  const fuel = fuelRes.data ?? [];
  const services = servicesRes.data ?? [];
  const docs = docsRes.data ?? [];
  const pnl = pnlTotals(pnlRes.data ?? []);

  const km = trips.reduce((s, t) => s + Math.max(t.distance_km ?? 0, 0), 0);
  const loadedTrips = trips.filter((t) => !t.is_empty_return).length;
  const emptyTrips = trips.length - loadedTrips;
  const liters = fuel.reduce((s, f) => s + (f.liters ?? 0), 0);
  // Weighted km/L over measured segments: total km / total liters in those segments.
  const measured = fuel.filter((f) => f.km_per_liter && f.km_since_last_full);
  const measuredKm = measured.reduce((s, f) => s + (f.km_since_last_full ?? 0), 0);
  const measuredLiters = measured.reduce((s, f) => s + (f.km_since_last_full ?? 0) / (f.km_per_liter ?? 1), 0);
  const avgKmpl = measuredLiters ? measuredKm / measuredLiters : null;
  const abnormal = fuel.filter((f) => f.is_abnormal).length;

  const maxCost = Math.max(...COST_KINDS.map((k) => pnl.byKind[k] ?? 0), 1);

  return (
    <>
      {finance ? (
        <Card>
          <CardHeader title="الربحية" subtitle={range.label} />
          <CardBody className="flex flex-col gap-5">
            <StatGrid>
              <Stat label="الإيرادات" value={formatMoney(pnl.revenue)} />
              <Stat label="إجمالي التكاليف" value={formatMoney(pnl.costs)} />
              <Stat
                label="صافي الربح"
                value={formatMoney(pnl.profit)}
                tone={pnl.profit >= 0 ? "success" : "danger"}
                hint={pnl.revenue ? `هامش ${Math.round((pnl.profit / pnl.revenue) * 100)}%` : undefined}
              />
              <Stat
                label="التكلفة لكل كم"
                value={formatMoney(perUnit(pnl.costs, km))}
                hint={
                  <>
                    ربح الرحلة: <span className="num">{formatMoney(perUnit(pnl.profit, trips.length), "JOD", { fractionDigits: 0 })}</span>
                  </>
                }
              />
            </StatGrid>
            <div>
              <h3 className="mb-2 text-sm font-semibold">توزيع التكاليف</h3>
              <ul className="flex flex-col gap-2">
                {COST_KINDS.map((kind) => {
                  const value = pnl.byKind[kind] ?? 0;
                  return (
                    <li key={kind} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-sm">
                      <span className="text-muted">{PNL_KIND[kind]}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                        <span
                          className="block h-full rounded-full bg-[var(--chart-cost)]"
                          style={{ width: `${(value / maxCost) * 100}%` }}
                        />
                      </span>
                      <span className="num w-28 text-start">{formatMoney(value, "JOD", { fractionDigits: 0 })}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <StatGrid>
        <Stat
          label="الرحلات"
          value={formatInt(trips.length)}
          hint={`${formatInt(loadedTrips)} محملة · ${formatInt(emptyTrips)} عودة فارغة`}
        />
        <Stat label="المسافة" value={`${formatInt(km)} كم`} />
        <Stat label="الديزل" value={`${formatInt(liters)} لتر`} />
        <Stat
          label="معدل الاستهلاك"
          value={avgKmpl ? `${formatDecimal(avgKmpl)} كم/لتر` : "—"}
          hint={abnormal ? `${formatInt(abnormal)} تعبئة باستهلاك غير طبيعي` : "لا توجد تعبئات غير طبيعية"}
          tone={abnormal ? "warning" : "neutral"}
        />
      </StatGrid>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="الصيانة القادمة"
            action={
              <Link href={`/trucks/${id}/maintenance`} className="text-sm text-primary hover:underline">
                الصيانة
              </Link>
            }
          />
          {services.length === 0 ? (
            <EmptyState>لا توجد جداول صيانة.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {services.map((s) => {
                const st = SERVICE_STATUS[s.due_status ?? "ok"];
                return (
                  <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <span>
                      {s.service_name}
                      <span className="block text-xs text-muted">
                        {s.km_left !== null ? (
                          <>
                            متبقي <span className="num">{formatInt(s.km_left)}</span> كم
                          </>
                        ) : null}
                        {s.next_due_on ? ` · ${formatDate(s.next_due_on)}` : null}
                      </span>
                    </span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="أقرب الوثائق انتهاءً"
            action={
              <Link href={`/trucks/${id}/documents`} className="text-sm text-primary hover:underline">
                الوثائق
              </Link>
            }
          />
          {docs.length === 0 ? (
            <EmptyState>لا توجد وثائق.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {docs.map((d) => {
                const band = EXPIRY_BAND[d.expiry_band ?? "none"];
                return (
                  <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <span>
                      {DOC_TYPE[d.doc_type ?? "other"]}
                      <span className="block text-xs text-muted">{formatDate(d.expiry_date)}</span>
                    </span>
                    <Badge tone={band.tone}>
                      {d.days_left !== null && d.days_left >= 0 ? `${d.days_left} يوم` : band.label}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
