import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { canSeeFinancials, STAFF_ROLES, TRIP_WRITERS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { inclusiveEnd, resolveRange } from "@/lib/date-range";
import { tripInRange } from "@/lib/truck";
import { formatMoney } from "@/lib/money";
import { formatDate, formatInt } from "@/lib/format";
import { TRIP_STATUS } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { buttonClass, LinkButton } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";

export const metadata: Metadata = { title: "الرحلات" };

type SearchParams = Promise<{ status?: string; truck?: string; driver?: string; from?: string; to?: string }>;

const UUID = /^[0-9a-f-]{36}$/i;

export default async function TripsPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireRole(...STAFF_ROLES);
  const finance = canSeeFinancials(profile.role);
  const canWrite = TRIP_WRITERS.includes(profile.role);
  const sp = await searchParams;
  const range = sp.from && sp.to ? resolveRange({ range: "custom", from: sp.from, to: sp.to }) : resolveRange({ range: "month" });
  const status = sp.status && TRIP_STATUS[sp.status] ? sp.status : "";
  const truck = sp.truck && UUID.test(sp.truck) ? sp.truck : "";
  const driver = sp.driver && UUID.test(sp.driver) ? sp.driver : "";

  const supabase = await createClient();
  // Running and planned trips always show, whatever their date.
  let query = supabase
    .from("trip_profit_v")
    .select("*")
    .or(`${tripInRange(range)},status.eq.in_progress,status.eq.planned`)
    .order("start_date", { ascending: false })
    .order("trip_no", { ascending: false })
    .limit(500);
  if (status) query = query.eq("status", status as "planned" | "in_progress" | "completed" | "cancelled");
  if (truck) query = query.eq("truck_id", truck);
  if (driver) query = query.eq("driver_id", driver);

  // Loading sheet lines and customer references live on trips, not in the profit view.
  let refsQuery = supabase
    .from("trips")
    .select("id, entry_source, client_ref")
    .or(`${tripInRange(range)},status.eq.in_progress,status.eq.planned`)
    .limit(500);
  if (truck) refsQuery = refsQuery.eq("truck_id", truck);
  if (driver) refsQuery = refsQuery.eq("driver_id", driver);

  const [tripsRes, trucksRes, driversRes, refsRes] = await Promise.all([
    query,
    supabase.from("trucks").select("id, code").order("code"),
    supabase.from("drivers").select("id, full_name").order("full_name"),
    refsQuery,
  ]);
  const trips = tripsRes.data ?? [];
  const refs = new Map((refsRes.data ?? []).map((r) => [r.id, r]));
  const codes = new Map((trucksRes.data ?? []).map((t) => [t.id, t.code]));
  const running = trips.filter((t) => t.status === "in_progress").length;
  const planned = trips.filter((t) => t.status === "planned").length;

  const select = "rounded-lg border border-border bg-surface px-3 py-2 text-sm";

  return (
    <>
      <PageHeader
        title="الرحلات"
        subtitle={`${formatInt(running)} جارية · ${formatInt(planned)} مخططة · ${formatInt(trips.length)} في القائمة`}
        action={
          canWrite ? (
            <LinkButton href="/trips/new" variant="primary">
              <Plus className="size-4" aria-hidden />
              رحلة جديدة
            </LinkButton>
          ) : null
        }
      />

      <form action="/trips" className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1 text-xs text-muted">
          الحالة
          <select name="status" defaultValue={status} className={select}>
            <option value="">الكل</option>
            {Object.entries(TRIP_STATUS).map(([value, s]) => (
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
          من
          <input type="date" name="from" defaultValue={range.from} className={select} dir="ltr" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          إلى
          <input type="date" name="to" defaultValue={inclusiveEnd(range)} className={select} dir="ltr" />
        </label>
        <button type="submit" className={buttonClass("secondary")}>
          عرض
        </button>
      </form>

      <Card>
        {trips.length === 0 ? (
          <EmptyState>لا توجد رحلات بهذه الشروط.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>رقم</Th>
                <Th>التاريخ</Th>
                <Th>الشاحنة</Th>
                <Th>السائق</Th>
                <Th>المسار</Th>
                <Th>العميل</Th>
                <Th className="text-end">كم</Th>
                <Th className="text-end">الأجرة</Th>
                {finance ? <Th className="text-end">الربح</Th> : null}
                <Th>الحالة</Th>
              </tr>
            </thead>
            <tbody>
              {trips.map((t) => {
                const st = TRIP_STATUS[t.status ?? "planned"];
                return (
                  <Tr key={t.trip_id}>
                    <Td>
                      <Link href={`/trips/${t.trip_id}`} className="num font-semibold text-primary hover:underline">
                        {t.trip_no}
                      </Link>
                      {refs.get(t.trip_id ?? "")?.client_ref ? (
                        <span className="num block text-xs text-muted" dir="ltr">
                          {refs.get(t.trip_id ?? "")?.client_ref}
                        </span>
                      ) : null}
                    </Td>
                    <Td className="num whitespace-nowrap">{formatDate(t.start_date)}</Td>
                    <Td className="num whitespace-nowrap">{codes.get(t.truck_id ?? "") ?? "—"}</Td>
                    <Td className="whitespace-nowrap">{t.driver_name ?? "—"}</Td>
                    <Td className="whitespace-nowrap">
                      {t.from_name} ← {t.to_name}
                    </Td>
                    <Td>{t.is_empty_return ? <Badge>عودة فارغة</Badge> : (t.client_name ?? "—")}</Td>
                    <Td className="num text-end">{formatInt(t.distance_km)}</Td>
                    <Td className="num whitespace-nowrap text-end">{formatMoney(t.freight_minor, t.currency ?? "JOD")}</Td>
                    {finance ? (
                      <Td
                        className={`num whitespace-nowrap text-end ${(t.profit_base_minor ?? 0) >= 0 ? "text-success" : "text-danger"}`}
                      >
                        {t.status === "completed" ? formatMoney(t.profit_base_minor, "JOD", { withCurrency: false }) : "—"}
                      </Td>
                    ) : null}
                    <Td className="whitespace-nowrap">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {refs.get(t.trip_id ?? "")?.entry_source === "sheet" ? (
                        <span className="ms-1">
                          <Badge tone="info">كشف</Badge>
                        </span>
                      ) : null}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
