import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatDecimal, formatInt } from "@/lib/format";
import { TRIP_STATUS } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";

export const metadata: Metadata = { title: "رحلاتي" };

// Drivers see only their own rows; the database enforces this with RLS.
export default async function MyTripsPage() {
  const profile = await requireRole("driver");
  const supabase = await createClient();

  const [driverRes, tripsRes, fuelRes] = await Promise.all([
    supabase.from("drivers").select("full_name, license_expiry, default_truck_id").maybeSingle(),
    supabase
      .from("trip_profit_v")
      .select("trip_id, trip_no, start_date, end_date, from_name, to_name, client_name, cargo_description, is_empty_return, distance_km, status")
      .order("start_date", { ascending: false })
      .limit(50),
    supabase
      .from("fuel_fillups")
      .select("id, filled_at, odometer, liters, is_full_tank")
      .order("filled_at", { ascending: false })
      .limit(20),
  ]);
  const driver = driverRes.data;
  const trips = tripsRes.data ?? [];
  const fills = fuelRes.data ?? [];

  if (!profile.driver_id || !driver) {
    return (
      <>
        <PageHeader title="رحلاتي" />
        <Card>
          <EmptyState>حسابك غير مرتبط بسجل سائق بعد. تواصل مع مدير النظام.</EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`أهلاً ${driver.full_name}`}
        subtitle={
          <>
            انتهاء رخصة القيادة: <span className="num">{formatDate(driver.license_expiry)}</span>
          </>
        }
      />
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="رحلاتي" subtitle="آخر 50 رحلة" />
          {trips.length === 0 ? (
            <EmptyState>لا توجد رحلات.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>رقم</Th>
                  <Th>التاريخ</Th>
                  <Th>المسار</Th>
                  <Th>العميل والحمولة</Th>
                  <Th className="text-end">كم</Th>
                  <Th>الحالة</Th>
                </tr>
              </thead>
              <tbody>
                {trips.map((t) => {
                  const st = TRIP_STATUS[t.status ?? "planned"];
                  return (
                    <Tr key={t.trip_id}>
                      <Td className="num">{t.trip_no}</Td>
                      <Td className="num whitespace-nowrap">{formatDate(t.start_date)}</Td>
                      <Td className="whitespace-nowrap">
                        {t.from_name} ← {t.to_name}
                      </Td>
                      <Td>
                        {t.is_empty_return ? (
                          <Badge>عودة فارغة</Badge>
                        ) : (
                          <>
                            {t.client_name ?? "—"}
                            <span className="block text-xs text-muted">{t.cargo_description}</span>
                          </>
                        )}
                      </Td>
                      <Td className="num text-end">{formatInt(t.distance_km)}</Td>
                      <Td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="تعبئة الديزل" subtitle="آخر 20 تعبئة" />
          {fills.length === 0 ? (
            <EmptyState>لا توجد تعبئات.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>الوقت</Th>
                  <Th className="text-end">العداد</Th>
                  <Th className="text-end">لتر</Th>
                  <Th>النوع</Th>
                </tr>
              </thead>
              <tbody>
                {fills.map((f) => (
                  <Tr key={f.id}>
                    <Td className="num whitespace-nowrap">{formatDateTime(f.filled_at)}</Td>
                    <Td className="num text-end">{formatInt(f.odometer)}</Td>
                    <Td className="num text-end">{formatDecimal(f.liters)}</Td>
                    <Td>{f.is_full_tank ? "كاملة" : "جزئية"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <p className="text-sm text-muted">إدخال المصاريف وصور الإيصالات من الهاتف يأتي في المرحلة الثانية.</p>
      </div>
    </>
  );
}
