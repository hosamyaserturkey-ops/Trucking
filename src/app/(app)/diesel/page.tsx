import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, Paperclip, Plus } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { canSeeFinancials, FUEL_WRITERS, STAFF_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { inclusiveEnd, resolveRange } from "@/lib/date-range";
import { formatQuantity, quantitySummary, weightedKmPerLiter, zonedIso } from "@/lib/fuel";
import { formatMoney, sumMinor } from "@/lib/money";
import { formatDateTime, formatDecimal, formatInt } from "@/lib/format";
import { EXPENSE_STATUS, PAYMENT_METHOD } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { buttonClass, LinkButton } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";

export const metadata: Metadata = { title: "الديزل" };

type SearchParams = Promise<{
  status?: string;
  truck?: string;
  driver?: string;
  station?: string;
  abnormal?: string;
  from?: string;
  to?: string;
  saved?: string;
}>;

const UUID = /^[0-9a-f-]{36}$/i;

/** Rank rows by km/L, weighted by distance, against the baseline. */
function rank<T extends string>(
  rows: { key: T | null; km: number | null; kmPerLiter: number | null; baseline: number | null }[],
): { key: T; kmPerLiter: number; baseline: number | null; km: number }[] {
  const groups = new Map<T, typeof rows>();
  for (const r of rows) {
    if (!r.key) continue;
    groups.set(r.key, [...(groups.get(r.key) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      kmPerLiter: weightedKmPerLiter(g)!,
      baseline: g.find((r) => r.baseline !== null)?.baseline ?? null,
      km: g.reduce((s, r) => s + Math.max(r.km ?? 0, 0), 0),
    }))
    .filter((r) => r.kmPerLiter !== null)
    .sort((a, b) => a.kmPerLiter - b.kmPerLiter);
}

export default async function DieselPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireRole(...STAFF_ROLES);
  const finance = canSeeFinancials(profile.role);
  const canWrite = FUEL_WRITERS.includes(profile.role);
  const sp = await searchParams;
  const range = sp.from && sp.to ? resolveRange({ range: "custom", from: sp.from, to: sp.to }) : resolveRange({ range: "month" });
  const status = sp.status && EXPENSE_STATUS[sp.status] ? sp.status : "";
  const truck = sp.truck && UUID.test(sp.truck) ? sp.truck : "";
  const driver = sp.driver && UUID.test(sp.driver) ? sp.driver : "";
  const station = sp.station && UUID.test(sp.station) ? sp.station : "";
  const abnormalOnly = sp.abnormal === "1";

  const supabase = await createClient();
  let fillsQuery = supabase
    .from("fuel_fillups")
    .select(
      "id, filled_at, odometer, qty_unit, quantity, unit_price_minor, is_full_tank, currency, amount_minor, amount_base_minor, payment_method, status, receipt_path, settlement_id, truck_id, driver_id, truck:trucks(code), driver:drivers(full_name), station:suppliers(name)",
    )
    .gte("filled_at", zonedIso(range.from, "00:00"))
    .lt("filled_at", zonedIso(range.to, "00:00"))
    .order("filled_at", { ascending: false })
    .limit(400);
  if (status) fillsQuery = fillsQuery.eq("status", status);
  if (truck) fillsQuery = fillsQuery.eq("truck_id", truck);
  if (driver) fillsQuery = fillsQuery.eq("driver_id", driver);
  if (station) fillsQuery = fillsQuery.eq("station_id", station);

  // Approved fill-ups with their km/L (full-tank method) for totals and rankings.
  let effQuery = supabase
    .from("fuel_efficiency_v")
    .select("id, truck_id, driver_id, qty_unit, quantity, liters, amount_base_minor, km_since_last_full, km_per_liter, baseline_km_per_liter, is_abnormal")
    .gte("filled_on", range.from)
    .lt("filled_on", range.to);
  if (truck) effQuery = effQuery.eq("truck_id", truck);
  if (driver) effQuery = effQuery.eq("driver_id", driver);
  if (station) effQuery = effQuery.eq("station_id", station);

  const [fillsRes, effRes, trucksRes, driversRes, stationsRes] = await Promise.all([
    fillsQuery,
    effQuery,
    supabase.from("trucks").select("id, code").order("code"),
    supabase.from("drivers").select("id, full_name").order("full_name"),
    supabase.from("suppliers").select("id, name").eq("kind", "fuel_station").order("name"),
  ]);
  const eff = effRes.data ?? [];
  const effById = new Map(eff.map((e) => [e.id!, e]));
  let fills = fillsRes.data ?? [];
  if (abnormalOnly) fills = fills.filter((f) => effById.get(f.id)?.is_abnormal);

  const truckCode = new Map((trucksRes.data ?? []).map((t) => [t.id, t.code]));
  const driverName = new Map((driversRes.data ?? []).map((d) => [d.id, d.full_name]));
  // Approved quantities per unit; the price per liter only from fill-ups in liters.
  const literRows = eff.filter((e) => e.qty_unit === "liter");
  const liters = literRows.reduce((s, e) => s + Number(e.quantity ?? 0), 0);
  const litersCost = sumMinor(literRows.map((e) => e.amount_base_minor));
  const cost = sumMinor(eff.map((e) => e.amount_base_minor));
  const quantities = quantitySummary(eff, 0);
  const measured = eff.map((e) => ({
    km: e.km_since_last_full,
    kmPerLiter: e.km_per_liter,
    baseline: e.baseline_km_per_liter,
  }));
  const avgKmPerLiter = weightedKmPerLiter(measured);
  const abnormalCount = eff.filter((e) => e.is_abnormal).length;
  const waiting = (fillsRes.data ?? []).filter((f) => f.status === "submitted").length;
  const trucks = rank(eff.map((e, i) => ({ key: e.truck_id, ...measured[i] })));
  const drivers = rank(eff.map((e, i) => ({ key: e.driver_id, ...measured[i] })));

  const select = "rounded-lg border border-border bg-surface px-3 py-2 text-sm";
  const pct = (v: number, b: number | null) => (b ? Math.round(((v - b) / b) * 100) : null);

  return (
    <>
      <PageHeader
        title="الديزل"
        subtitle={`${formatInt(fills.length)} تعبئة في القائمة · من ${range.from} إلى ${inclusiveEnd(range)}`}
        action={
          canWrite ? (
            <LinkButton href="/diesel/new" variant="primary">
              <Plus className="size-4" aria-hidden />
              تعبئة
            </LinkButton>
          ) : null
        }
      />

      <form action="/diesel" className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1 text-xs text-muted">
          الحالة
          <select name="status" defaultValue={status} className={select}>
            <option value="">الكل</option>
            {Object.entries(EXPENSE_STATUS).map(([value, s]) => (
              <option key={value} value={value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          الشاحنة
          <select name="truck" defaultValue={truck} className={select}>
            <option value="">الكل</option>
            {(trucksRes.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.code}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          السائق
          <select name="driver" defaultValue={driver} className={select}>
            <option value="">الكل</option>
            {(driversRes.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          المحطة
          <select name="station" defaultValue={station} className={select}>
            <option value="">الكل</option>
            {(stationsRes.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          من
          <input type="date" name="from" defaultValue={range.from} className={select} dir="ltr" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          إلى
          <input type="date" name="to" defaultValue={inclusiveEnd(range)} className={select} dir="ltr" />
        </label>
        <label className="flex items-center gap-2 py-2 text-sm">
          <input type="checkbox" name="abnormal" value="1" defaultChecked={abnormalOnly} className="size-4" />
          استهلاك غير طبيعي فقط
        </label>
        <button type="submit" className={buttonClass("secondary")}>
          عرض
        </button>
      </form>

      <div className="flex flex-col gap-5">
        {sp.saved ? (
          <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
            تم حفظ التعبئة{profile.role === "dispatcher" ? " وإرسالها للموافقة" : ""}.
          </p>
        ) : null}
        <StatGrid>
          <Stat label="الكمية المعتمدة" value={quantities || "—"} />
          {finance ? <Stat label="تكلفة الديزل" value={formatMoney(cost, "JOD", { fractionDigits: 0 })} /> : null}
          <Stat label="متوسط سعر اللتر" value={liters > 0 ? formatMoney(Math.round(litersCost / liters), "JOD") : "—"} />
          <Stat label="متوسط كم/لتر" value={avgKmPerLiter !== null ? formatDecimal(avgKmPerLiter) : "—"} />
          <Stat label="استهلاك غير طبيعي" value={formatInt(abnormalCount)} tone={abnormalCount ? "danger" : "success"} />
          <Stat label="بانتظار الموافقة" value={formatInt(waiting)} tone={waiting ? "warning" : "neutral"} />
        </StatGrid>

        <div className="grid gap-5 lg:grid-cols-2">
          {[
            { title: "الشاحنات حسب كم/لتر", rows: trucks.map((r) => ({ ...r, name: truckCode.get(r.key) ?? "—" })) },
            { title: "السائقون حسب كم/لتر", rows: drivers.map((r) => ({ ...r, name: driverName.get(r.key) ?? "—" })) },
          ].map((block) => (
            <Card key={block.title}>
              <CardHeader title={block.title} subtitle="الأقل كفاءة أولاً؛ موزون بالمسافة" />
              {block.rows.length === 0 ? (
                <EmptyState>لا توجد قراءات كافية في هذه الفترة.</EmptyState>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>الاسم</Th>
                      <Th className="text-end">كم/لتر</Th>
                      <Th className="text-end">المعتاد</Th>
                      <Th className="text-end">الفرق</Th>
                      <Th className="text-end">كم</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.slice(0, 10).map((r) => {
                      const diff = pct(r.kmPerLiter, r.baseline);
                      return (
                        <Tr key={r.key}>
                          <Td className="whitespace-nowrap">{r.name}</Td>
                          <Td className="num text-end">{formatDecimal(r.kmPerLiter)}</Td>
                          <Td className="num text-end">{r.baseline !== null ? formatDecimal(r.baseline) : "—"}</Td>
                          <Td className={`num text-end ${diff !== null && diff <= -15 ? "text-danger" : ""}`}>
                            {diff !== null ? `${diff > 0 ? "+" : ""}${diff}%` : "—"}
                          </Td>
                          <Td className="num text-end">{formatInt(r.km)}</Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader title="سجل التعبئات" subtitle="آخر 400 في الفترة" />
          {fills.length === 0 ? (
            <EmptyState>لا توجد تعبئات.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>الوقت</Th>
                  <Th>الشاحنة</Th>
                  <Th>السائق</Th>
                  <Th>المحطة</Th>
                  <Th className="text-end">الكمية</Th>
                  <Th className="text-end">سعر الوحدة</Th>
                  <Th className="text-end">الكلفة (د.أ)</Th>
                  <Th className="text-end">العداد</Th>
                  <Th className="text-end">كم/لتر</Th>
                  <Th>الدفع</Th>
                  <Th>الحالة</Th>
                  <Th>
                    <span className="sr-only">إجراءات</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {fills.map((f) => {
                  const e = effById.get(f.id);
                  const st = EXPENSE_STATUS[f.status];
                  const editable = !f.settlement_id && (finance || (canWrite && f.status === "submitted"));
                  return (
                    <Tr key={f.id}>
                      <Td className="num whitespace-nowrap">{formatDateTime(f.filled_at)}</Td>
                      <Td className="num whitespace-nowrap">
                        <Link href={`/trucks/${f.truck_id}/diesel`} className="hover:underline">
                          {(f.truck as { code: string } | null)?.code}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap">{(f.driver as { full_name: string } | null)?.full_name ?? "—"}</Td>
                      <Td className="whitespace-nowrap">{(f.station as { name: string } | null)?.name ?? "—"}</Td>
                      <Td className="num text-end whitespace-nowrap">
                        {formatQuantity(Number(f.quantity), f.qty_unit)}
                        {f.is_full_tank ? "" : <span className="ms-1 text-xs text-muted">جزئية</span>}
                      </Td>
                      <Td className="num text-end whitespace-nowrap">{formatMoney(f.unit_price_minor, f.currency)}</Td>
                      <Td className="num text-end whitespace-nowrap">
                        {formatMoney(f.amount_base_minor, "JOD", { withCurrency: false })}
                        {f.currency !== "JOD" ? <span className="block text-xs text-muted">{formatMoney(f.amount_minor, f.currency)}</span> : null}
                      </Td>
                      <Td className="num text-end">{formatInt(f.odometer)}</Td>
                      <Td className={`num text-end whitespace-nowrap ${e?.is_abnormal ? "font-semibold text-danger" : ""}`}>
                        {e?.km_per_liter != null ? formatDecimal(e.km_per_liter) : "—"}
                        {e?.is_abnormal ? <AlertTriangle className="ms-1 inline size-3.5" aria-label="استهلاك غير طبيعي" /> : null}
                      </Td>
                      <Td className="whitespace-nowrap">{PAYMENT_METHOD[f.payment_method] ?? f.payment_method}</Td>
                      <Td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {f.receipt_path ? (
                          <a href={`/files/fuel/${f.id}`} target="_blank" rel="noreferrer" className="me-2 inline-flex text-muted hover:text-text">
                            <Paperclip className="size-4" aria-label="الإيصال" />
                          </a>
                        ) : null}
                        {editable ? (
                          <Link href={`/diesel/${f.id}/edit`} className="text-xs text-primary hover:underline">
                            تعديل
                          </Link>
                        ) : null}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
