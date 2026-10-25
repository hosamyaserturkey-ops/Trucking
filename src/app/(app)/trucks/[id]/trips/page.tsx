import { requireRole } from "@/lib/auth";
import { canSeeFinancials, STAFF_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { truckPage, tripInRange, type TruckPageProps } from "@/lib/truck";
import { formatMoney, sumMinor } from "@/lib/money";
import { formatDate, formatDecimal, formatInt } from "@/lib/format";
import { TRIP_STATUS } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";

export default async function TruckTripsPage(props: TruckPageProps) {
  const profile = await requireRole(...STAFF_ROLES);
  const { id, range } = await truckPage(props);
  const finance = canSeeFinancials(profile.role);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("trip_profit_v")
    .select("*")
    .eq("truck_id", id)
    .or(tripInRange(range))
    .order("start_date", { ascending: false });
  const trips = data ?? [];

  const counted = trips.filter((t) => t.status !== "cancelled");
  const totals = {
    km: counted.reduce((s, t) => s + Math.max(t.distance_km ?? 0, 0), 0),
    freight: sumMinor(counted.map((t) => t.freight_base_minor)),
    fuel: sumMinor(counted.map((t) => t.fuel_base_minor)),
    expenses: sumMinor(counted.map((t) => t.expenses_base_minor)),
    profit: sumMinor(counted.map((t) => t.profit_base_minor)),
  };

  return (
    <Card>
      <CardHeader
        title="الرحلات"
        subtitle={`${formatInt(trips.length)} رحلة · ${formatInt(totals.km)} كم · ${range.label}`}
      />
      {error ? (
        <EmptyState>تعذر تحميل الرحلات: {error.message}</EmptyState>
      ) : trips.length === 0 ? (
        <EmptyState>لا توجد رحلات في هذه الفترة.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>رقم</Th>
              <Th>التاريخ</Th>
              <Th>المسار</Th>
              <Th>العميل والحمولة</Th>
              <Th>السائق</Th>
              <Th className="text-end">كم</Th>
              <Th className="text-end">الأجرة</Th>
              {finance ? (
                <>
                  <Th className="text-end">الديزل</Th>
                  <Th className="text-end">مصاريف</Th>
                  <Th className="text-end">الربح</Th>
                </>
              ) : null}
              <Th className="text-end">كم/لتر</Th>
              <Th>الحالة</Th>
            </tr>
          </thead>
          <tbody>
            {trips.map((t) => {
              const st = TRIP_STATUS[t.status ?? "planned"];
              return (
                <Tr key={t.trip_id}>
                  <Td className="num">{t.trip_no}</Td>
                  <Td className="num whitespace-nowrap">
                    {formatDate(t.start_date)}
                    {t.end_date && t.end_date !== t.start_date ? (
                      <span className="block text-xs text-muted">{formatDate(t.end_date)}</span>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {t.from_name} ← {t.to_name}
                  </Td>
                  <Td>
                    {t.is_empty_return ? (
                      <Badge tone="neutral">عودة فارغة</Badge>
                    ) : (
                      <>
                        {t.client_name ?? "—"}
                        <span className="block text-xs text-muted">{t.cargo_description}</span>
                      </>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{t.driver_name ?? "—"}</Td>
                  <Td className="num text-end">{formatInt(t.distance_km)}</Td>
                  <Td className="num whitespace-nowrap text-end">
                    {formatMoney(t.freight_minor, t.currency ?? "JOD")}
                    {t.currency && t.currency !== "JOD" ? (
                      <span className="block text-xs text-muted">{formatMoney(t.freight_base_minor)}</span>
                    ) : null}
                  </Td>
                  {finance ? (
                    <>
                      <Td className="num whitespace-nowrap text-end">{formatMoney(t.fuel_base_minor, "JOD", { withCurrency: false })}</Td>
                      <Td className="num whitespace-nowrap text-end">{formatMoney(t.expenses_base_minor, "JOD", { withCurrency: false })}</Td>
                      <Td
                        className={`num whitespace-nowrap text-end font-semibold ${
                          (t.profit_base_minor ?? 0) >= 0 ? "text-success" : "text-danger"
                        }`}
                      >
                        {formatMoney(t.profit_base_minor, "JOD", { withCurrency: false })}
                      </Td>
                    </>
                  ) : null}
                  <Td className="num text-end">{formatDecimal(t.km_per_liter)}</Td>
                  <Td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <Td>المجموع</Td>
              <Td />
              <Td />
              <Td />
              <Td />
              <Td className="num text-end">{formatInt(totals.km)}</Td>
              <Td className="num whitespace-nowrap text-end">{formatMoney(totals.freight)}</Td>
              {finance ? (
                <>
                  <Td className="num whitespace-nowrap text-end">{formatMoney(totals.fuel, "JOD", { withCurrency: false })}</Td>
                  <Td className="num whitespace-nowrap text-end">{formatMoney(totals.expenses, "JOD", { withCurrency: false })}</Td>
                  <Td className={`num whitespace-nowrap text-end ${totals.profit >= 0 ? "text-success" : "text-danger"}`}>
                    {formatMoney(totals.profit, "JOD", { withCurrency: false })}
                  </Td>
                </>
              ) : null}
              <Td />
              <Td />
            </tr>
          </tfoot>
        </Table>
      )}
      {finance ? (
        <p className="px-4 py-3 text-xs text-muted">
          ربح الرحلة = الأجرة ناقص الديزل والمصاريف المرتبطة بها. الاستهلاك والمصاريف العامة تظهر في تبويب المالية.
        </p>
      ) : null}
    </Card>
  );
}
