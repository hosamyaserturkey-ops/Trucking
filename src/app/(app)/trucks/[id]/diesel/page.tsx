import { AlertTriangle, Plus } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { FUEL_WRITERS, STAFF_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { truckPage, type TruckPageProps } from "@/lib/truck";
import { formatMoney, sumMinor } from "@/lib/money";
import { formatDateTime, formatDecimal, formatInt } from "@/lib/format";
import { formatQuantity, quantitySummary } from "@/lib/fuel";
import { EXPENSE_STATUS, PAYMENT_METHOD } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";

export default async function TruckDieselPage(props: TruckPageProps) {
  const profile = await requireRole(...STAFF_ROLES);
  const { id, truck, range } = await truckPage(props);
  const supabase = await createClient();

  const [fuelRes, stationsRes, settingsRes, otherRes] = await Promise.all([
    supabase
      .from("fuel_efficiency_v")
      .select("*")
      .eq("truck_id", id)
      .gte("filled_on", range.from)
      .lt("filled_on", range.to)
      .order("filled_at", { ascending: false }),
    supabase.from("suppliers").select("id, name").eq("kind", "fuel_station"),
    supabase.from("company_settings").select("fuel_anomaly_threshold_pct").maybeSingle(),
    // Fill-ups still waiting or rejected do not count yet; list them separately.
    supabase
      .from("fuel_fillups")
      .select("id, filled_at, odometer, qty_unit, quantity, unit_price_minor, currency, amount_minor, status, rejection_reason, station_id, driver:drivers(full_name)")
      .eq("truck_id", id)
      .neq("status", "approved")
      .order("filled_at", { ascending: false })
      .limit(20),
  ]);
  const others = otherRes.data ?? [];
  const rows = fuelRes.data ?? [];
  const stations = new Map((stationsRes.data ?? []).map((s) => [s.id, s.name]));
  const threshold = settingsRes.data?.fuel_anomaly_threshold_pct ?? 15;

  const literRows = rows.filter((r) => r.qty_unit === "liter");
  const liters = literRows.reduce((s, r) => s + Number(r.quantity ?? 0), 0);
  const litersCost = sumMinor(literRows.map((r) => r.amount_base_minor));
  const cost = sumMinor(rows.map((r) => r.amount_base_minor));
  const measured = rows.filter((r) => r.km_per_liter && r.km_since_last_full);
  const km = measured.reduce((s, r) => s + (r.km_since_last_full ?? 0), 0);
  const measuredLiters = measured.reduce((s, r) => s + (r.km_since_last_full ?? 0) / (r.km_per_liter ?? 1), 0);
  const avg = measuredLiters ? km / measuredLiters : null;
  const abnormal = rows.filter((r) => r.is_abnormal).length;
  const baseline = rows.find((r) => r.baseline_km_per_liter)?.baseline_km_per_liter ?? truck.expected_km_per_liter;

  return (
    <>
      <StatGrid>
        <Stat label="الكمية" value={quantitySummary(rows, 0) || "—"} hint={`${formatInt(rows.length)} تعبئة`} />
        <Stat label="التكلفة" value={formatMoney(cost)} hint={liters ? `${formatMoney(Math.round(litersCost / liters))} للتر` : undefined} />
        <Stat
          label="معدل الاستهلاك"
          value={avg ? `${formatDecimal(avg)} كم/لتر` : "—"}
          hint={baseline ? `المرجع ${formatDecimal(baseline)} كم/لتر` : undefined}
        />
        <Stat
          label="استهلاك غير طبيعي"
          value={formatInt(abnormal)}
          tone={abnormal ? "warning" : "success"}
          hint={`أقل من المرجع بأكثر من ${formatInt(threshold)}%`}
        />
      </StatGrid>

      {others.length ? (
        <Card>
          <CardHeader title="تعبئات لم تُحتسب" subtitle="بانتظار الموافقة أو مرفوضة؛ لا تدخل في كم/لتر ولا في التكاليف" />
          <Table>
            <thead>
              <tr>
                <Th>الوقت</Th>
                <Th>السائق</Th>
                <Th>المحطة</Th>
                <Th className="text-end">العداد</Th>
                <Th className="text-end">الكمية</Th>
                <Th className="text-end">سعر الوحدة</Th>
                <Th className="text-end">الكلفة</Th>
                <Th>الحالة</Th>
              </tr>
            </thead>
            <tbody>
              {others.map((f) => {
                const st = EXPENSE_STATUS[f.status];
                return (
                  <Tr key={f.id}>
                    <Td className="num whitespace-nowrap">{formatDateTime(f.filled_at)}</Td>
                    <Td className="whitespace-nowrap">{(f.driver as { full_name: string } | null)?.full_name ?? "—"}</Td>
                    <Td className="whitespace-nowrap">{(f.station_id && stations.get(f.station_id)) ?? "—"}</Td>
                    <Td className="num text-end">{formatInt(f.odometer)}</Td>
                    <Td className="num text-end whitespace-nowrap">{formatQuantity(Number(f.quantity), f.qty_unit)}</Td>
                    <Td className="num text-end whitespace-nowrap">{formatMoney(f.unit_price_minor, f.currency)}</Td>
                    <Td className="num text-end whitespace-nowrap">{formatMoney(f.amount_minor, f.currency)}</Td>
                    <Td>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {f.rejection_reason ? <span className="block text-xs text-muted">{f.rejection_reason}</span> : null}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="سجل التعبئة"
          subtitle="يُحسب كم/لتر بين تعبئتين كاملتين، ويشمل كل اللترات المعبأة بينهما؛ لا يُحسب إذا كان بينهما تعبئة بالقلن أو التنكة"
          action={
            FUEL_WRITERS.includes(profile.role) ? (
              <LinkButton href={`/diesel/new?truck=${id}`} variant="secondary">
                <Plus className="size-4" aria-hidden />
                تعبئة
              </LinkButton>
            ) : null
          }
        />
        {rows.length === 0 ? (
          <EmptyState>لا توجد تعبئات في هذه الفترة.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>التاريخ</Th>
                <Th>المحطة</Th>
                <Th className="text-end">العداد</Th>
                <Th className="text-end">الكمية</Th>
                <Th>نوع التعبئة</Th>
                <Th className="text-end">سعر الوحدة</Th>
                <Th className="text-end">الكلفة</Th>
                <Th className="text-end">كم منذ آخر تعبئة كاملة</Th>
                <Th className="text-end">كم/لتر</Th>
                <Th>الدفع</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id} className={r.is_abnormal ? "bg-warning-soft/60" : ""}>
                  <Td className="num whitespace-nowrap">{formatDateTime(r.filled_at)}</Td>
                  <Td className="whitespace-nowrap">{(r.station_id && stations.get(r.station_id)) ?? "—"}</Td>
                  <Td className="num text-end">{formatInt(r.odometer)}</Td>
                  <Td className="num whitespace-nowrap text-end">{formatQuantity(r.quantity, r.qty_unit)}</Td>
                  <Td>{r.is_full_tank ? "كاملة" : <Badge>جزئية</Badge>}</Td>
                  <Td className="num whitespace-nowrap text-end">{formatMoney(r.unit_price_minor, r.currency ?? "JOD")}</Td>
                  <Td className="num whitespace-nowrap text-end">
                    {formatMoney(r.amount_minor, r.currency ?? "JOD")}
                    {r.currency && r.currency !== "JOD" ? (
                      <span className="block text-xs text-muted">{formatMoney(r.amount_base_minor)}</span>
                    ) : null}
                  </Td>
                  <Td className="num text-end">{formatInt(r.km_since_last_full)}</Td>
                  <Td className="num whitespace-nowrap text-end">
                    {r.is_abnormal ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-warning">
                        <AlertTriangle className="size-3.5" aria-label="استهلاك غير طبيعي" />
                        {formatDecimal(r.km_per_liter)}
                      </span>
                    ) : (
                      formatDecimal(r.km_per_liter)
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{PAYMENT_METHOD[r.payment_method ?? ""] ?? r.payment_method}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
