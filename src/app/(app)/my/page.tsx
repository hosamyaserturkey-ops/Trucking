import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Paperclip, Plus } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, formatDecimal, formatInt } from "@/lib/format";
import { EXPENSE_STATUS, PAYMENT_METHOD, TRIP_STATUS } from "@/lib/labels";
import { deleteDriverExpense, driverTripAction } from "./actions";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { DriverTripControl, WithdrawExpenseButton } from "@/components/driver-trip-card";

export const metadata: Metadata = { title: "رحلاتي" };

// Drivers see only their own rows; the database enforces this with RLS.
export default async function MyTripsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const profile = await requireRole("driver");
  const { saved } = await searchParams;
  const supabase = await createClient();

  const [driverRes, tripsRes, activeRes, balanceRes, expensesRes, fuelRes] = await Promise.all([
    supabase.from("drivers").select("full_name, license_expiry, default_truck_id").maybeSingle(),
    supabase
      .from("trip_profit_v")
      .select("trip_id, trip_no, start_date, end_date, from_name, to_name, client_name, cargo_description, is_empty_return, distance_km, status")
      .order("start_date", { ascending: false })
      .limit(30),
    supabase
      .from("trips")
      .select("id, trip_no, status, start_date, start_odometer, truck_id, cargo_description, truck:trucks(code, plate_number)")
      .in("status", ["in_progress", "planned"])
      .order("start_date", { ascending: true }),
    supabase.from("driver_advance_balance_v").select("*").maybeSingle(),
    supabase
      .from("expenses")
      .select(
        "id, expense_date, description, currency, amount_minor, payment_method, status, rejection_reason, receipt_path, settlement_id, category:expense_categories(name_ar), trip:trips(trip_no)",
      )
      // What the driver sent in or paid from the advance, not company costs such as wages.
      .or(`submitted_by.eq.${profile.user_id},payment_method.eq.driver_advance`)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("fuel_fillups")
      .select("id, filled_at, odometer, liters, is_full_tank")
      .order("filled_at", { ascending: false })
      .limit(10),
  ]);
  const driver = driverRes.data;
  const trips = tripsRes.data ?? [];
  const fills = fuelRes.data ?? [];
  const expenses = expensesRes.data ?? [];
  const balance = balanceRes.data;

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

  const active = activeRes.data ?? [];
  const current = active.find((t) => t.status === "in_progress") ?? active.find((t) => t.status === "planned") ?? null;
  const currentTruck = current?.truck as { code: string; plate_number: string } | null | undefined;
  const route = current ? trips.find((t) => t.trip_id === current.id) : undefined;
  let truckOdometer: number | null = null;
  if (current?.status === "planned") {
    const { data } = await supabase.from("truck_overview_v").select("odometer").eq("truck_id", current.truck_id).maybeSingle();
    truckOdometer = data?.odometer ?? null;
  }

  const bal = balance?.balance_base_minor ?? 0;

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
        {saved ? (
          <p role="status" className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
            <CheckCircle2 className="size-4" aria-hidden />
            تم إرسال المصروف للموافقة.
          </p>
        ) : null}

        <Card>
          <CardHeader
            title={current?.status === "in_progress" ? "الرحلة الجارية" : "الرحلة القادمة"}
            subtitle={current ? `رحلة رقم ${current.trip_no}` : undefined}
            action={current ? <Badge tone={TRIP_STATUS[current.status].tone}>{TRIP_STATUS[current.status].label}</Badge> : undefined}
          />
          {current ? (
            <CardBody className="flex flex-col gap-4">
              <div className="flex flex-col gap-1 text-sm">
                <p className="text-base font-semibold">
                  {route?.from_name ?? "—"} ← {route?.to_name ?? "—"}
                </p>
                {currentTruck ? (
                  <p className="text-muted">
                    الشاحنة <span className="num">{currentTruck.code}</span> · <span className="num">{currentTruck.plate_number}</span>
                  </p>
                ) : null}
                {current.cargo_description ? <p className="text-muted">{current.cargo_description}</p> : null}
                <p className="text-muted">
                  {current.status === "in_progress" ? "بدأت" : "موعدها"}: <span className="num">{formatDate(current.start_date)}</span>
                </p>
              </div>
              <div className="max-w-sm">
                {current.status === "in_progress" ? (
                  <DriverTripControl
                    key={`finish-${current.id}`}
                    action={driverTripAction.bind(null, current.id, "finish")}
                    label="إنهاء الرحلة"
                    hint={`قراءة البداية: ${formatInt(current.start_odometer)} كم`}
                  />
                ) : (
                  <DriverTripControl
                    key={`start-${current.id}`}
                    action={driverTripAction.bind(null, current.id, "start")}
                    label="بدء الرحلة"
                    hint={truckOdometer !== null ? `آخر قراءة مسجلة للشاحنة: ${formatInt(truckOdometer)} كم` : undefined}
                    defaultOdometer={truckOdometer}
                  />
                )}
              </div>
            </CardBody>
          ) : (
            <EmptyState>لا توجد رحلة مخططة لك حالياً.</EmptyState>
          )}
        </Card>

        <section aria-label="العهدة" className="flex flex-col gap-3">
          <StatGrid>
            <Stat
              label={bal >= 0 ? "رصيد العهدة معك" : "لك على الشركة"}
              value={formatMoney(Math.abs(bal), "JOD")}
              tone={bal >= 0 ? "neutral" : "success"}
              hint={balance?.last_settled_on ? `آخر تسوية ${formatDate(balance.last_settled_on)}` : "لا توجد تسوية سابقة"}
            />
            <Stat label="عهد مستلمة" value={formatMoney(balance?.open_advances_base_minor ?? 0, "JOD")} hint="منذ آخر تسوية" />
            <Stat label="مصاريف معتمدة دفعتها" value={formatMoney(balance?.open_expenses_base_minor ?? 0, "JOD")} hint="تُخصم من العهدة" />
            <Stat
              label="بانتظار الموافقة"
              value={formatMoney(balance?.pending_base_minor ?? 0, "JOD")}
              hint={`${formatInt(balance?.pending_count ?? 0)} مصروف`}
              tone={(balance?.pending_count ?? 0) > 0 ? "warning" : "neutral"}
            />
          </StatGrid>
          <LinkButton href={current ? `/my/expense/new?trip=${current.id}` : "/my/expense/new"} variant="primary" className="w-full py-3 text-base sm:w-fit">
            <Plus className="size-5" aria-hidden />
            مصروف
          </LinkButton>
        </section>

        <Card>
          <CardHeader title="مصاريفي" subtitle="ما دفعته أو أرسلته، آخر 20" />
          {expenses.length === 0 ? (
            <EmptyState>لم تسجل أي مصروف بعد.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {expenses.map((e) => {
                const st = EXPENSE_STATUS[e.status];
                const category = e.category as { name_ar: string } | null;
                const trip = e.trip as { trip_no: number } | null;
                const editable = e.status === "submitted" && !e.settlement_id;
                return (
                  <li key={e.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {category?.name_ar ?? "مصروف"}
                          {e.receipt_path ? <Paperclip className="ms-1 inline size-3.5 text-muted" aria-label="مرفق إيصال" /> : null}
                        </p>
                        <p className="truncate text-xs text-muted">
                          <span className="num">{formatDate(e.expense_date)}</span>
                          {trip ? (
                            <>
                              {" "}
                              · رحلة <span className="num">{trip.trip_no}</span>
                            </>
                          ) : null}
                          {" · "}
                          {PAYMENT_METHOD[e.payment_method ?? ""] ?? e.payment_method}
                        </p>
                        {e.description && e.description !== category?.name_ar ? (
                          <p className="truncate text-xs text-muted">{e.description}</p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="num font-semibold">{formatMoney(e.amount_minor, e.currency)}</span>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </div>
                    </div>
                    {e.status === "rejected" && e.rejection_reason ? (
                      <p className="rounded-md bg-danger-soft px-2 py-1 text-xs text-danger">سبب الرفض: {e.rejection_reason}</p>
                    ) : null}
                    {editable ? (
                      <div className="flex items-center gap-4">
                        <Link href={`/my/expense/${e.id}`} className="text-xs text-primary hover:underline">
                          تعديل
                        </Link>
                        <WithdrawExpenseButton action={deleteDriverExpense.bind(null, e.id)} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="رحلاتي" subtitle="آخر 30 رحلة" />
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
          <CardHeader title="تعبئة الديزل" subtitle="آخر 10 تعبئات" />
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
      </div>
    </>
  );
}
