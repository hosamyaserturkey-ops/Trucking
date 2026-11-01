import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { STAFF_ROLES, TRIP_WRITERS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { formatDate, formatInt } from "@/lib/format";
import { SERVICE_STATUS } from "@/lib/labels";
import { loadMaintenanceOptions } from "@/lib/maintenance-options";
import { deleteServiceSchedule, saveServiceSchedule } from "../actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { ExportButton } from "@/components/export-button";
import { ConfirmButton, ServiceScheduleForm } from "@/components/work-order-forms";

export const metadata: Metadata = { title: "الصيانة الدورية" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD = "rounded-lg border border-border bg-surface px-3 py-2 text-sm";

/** Every periodic service of the fleet, its next due point, and the forms to add or change one. */
export default async function SchedulesPage({ searchParams }: { searchParams: Promise<{ truck?: string }> }) {
  const profile = await requireRole(...STAFF_ROLES);
  const canWrite = TRIP_WRITERS.includes(profile.role);
  const sp = await searchParams;
  const truck = sp.truck && UUID.test(sp.truck) ? sp.truck : "";
  const supabase = await createClient();
  const today = todayIso();

  let q = supabase
    .from("service_schedules")
    .select("id, truck_id, service_name, interval_km, interval_days, last_done_odometer, last_done_on, is_active, last_work_order_id, work_order:work_orders(wo_no)")
    .order("service_name");
  if (truck) q = q.eq("truck_id", truck);
  const [schedulesRes, dueRes, options] = await Promise.all([
    q,
    supabase.from("service_due_v").select("id, current_odometer, next_due_odometer, km_left, next_due_on, days_left, due_status"),
    loadMaintenanceOptions({ truckId: truck }),
  ]);
  const due = new Map((dueRes.data ?? []).map((d) => [d.id, d]));
  const code = new Map(options.trucks.map((t) => [t.id, t.label.split(" · ")[0]]));
  const rank: Record<string, number> = { overdue: 0, due_soon: 1, ok: 2 };
  const rows = (schedulesRes.data ?? [])
    .map((s) => ({ ...s, due: due.get(s.id) ?? null, code: code.get(s.truck_id) ?? "" }))
    .sort(
      (a, b) =>
        (rank[a.due?.due_status ?? "ok"] ?? 3) - (rank[b.due?.due_status ?? "ok"] ?? 3) ||
        Number(b.is_active) - Number(a.is_active) ||
        a.code.localeCompare(b.code) ||
        a.service_name.localeCompare(b.service_name, "ar"),
    );

  return (
    <>
      <Link href="/maintenance" className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        الصيانة
      </Link>
      <PageHeader
        title="الصيانة الدورية"
        subtitle="لكل شاحنة: كل كم كيلومتر و/أو كل كم يوم. تُسجّل كمنجزة عند إغلاق أمر الصيانة الذي تمت فيه"
      />
      <div className="flex flex-col gap-5">
        {canWrite ? (
          <Card>
            <CardHeader title="صيانة دورية جديدة" />
            <CardBody>
              <ServiceScheduleForm action={saveServiceSchedule.bind(null, null)} trucks={options.trucks} today={today} initial={{ truck_id: truck || undefined }} submitLabel="إضافة" />
            </CardBody>
          </Card>
        ) : null}

        <form action="/maintenance/schedules" className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1 text-xs text-muted">
            الشاحنة
            <select name="truck" defaultValue={truck} className={FIELD}>
              <option value="">الكل</option>
              {options.trucks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-surface-2">
            عرض
          </button>
        </form>

        <Card>
          <CardHeader
            title="الجداول"
            subtitle={`${formatInt(rows.length)} صيانة · المتأخرة أولاً`}
            action={<ExportButton tableId="schedules-table" file="service-schedules" title={`الصيانة الدورية في ${formatDate(today)}`} />}
          />
          {rows.length === 0 ? (
            <EmptyState>لا توجد جداول صيانة دورية.</EmptyState>
          ) : (
            <Table id="schedules-table">
              <thead>
                <tr>
                  <Th>الشاحنة</Th>
                  <Th>الصيانة</Th>
                  <Th>كل</Th>
                  <Th>آخر مرة</Th>
                  <Th>الموعد التالي</Th>
                  <Th>المتبقي</Th>
                  <Th>الحالة</Th>
                  {canWrite ? (
                    <Th>
                      <span className="sr-only">إجراءات</span>
                    </Th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const st = s.is_active ? SERVICE_STATUS[s.due?.due_status ?? "ok"] : null;
                  const wo = s.work_order as unknown as { wo_no: number } | null;
                  return (
                    <Tr key={s.id} className={s.is_active ? "" : "text-muted"}>
                      <Td className="num whitespace-nowrap font-semibold">
                        <Link href={`/trucks/${s.truck_id}/maintenance`} className="hover:underline">
                          {s.code}
                        </Link>
                      </Td>
                      <Td>{s.service_name}</Td>
                      <Td className="num whitespace-nowrap">
                        {[s.interval_km ? `${formatInt(s.interval_km)} كم` : null, s.interval_days ? `${formatInt(s.interval_days)} يوم` : null]
                          .filter(Boolean)
                          .join(" / ")}
                      </Td>
                      <Td className="num whitespace-nowrap text-xs">
                        {s.last_done_odometer !== null ? <span className="block">{formatInt(s.last_done_odometer)} كم</span> : null}
                        {s.last_done_on ? <span className="block">{formatDate(s.last_done_on)}</span> : null}
                        {wo && s.last_work_order_id ? (
                          <Link href={`/maintenance/${s.last_work_order_id}`} className="block text-primary hover:underline">
                            أمر #{wo.wo_no}
                          </Link>
                        ) : null}
                      </Td>
                      <Td className="num whitespace-nowrap text-xs">
                        {s.due?.next_due_odometer ? <span className="block">{formatInt(s.due.next_due_odometer)} كم</span> : null}
                        {s.due?.next_due_on ? <span className="block">{formatDate(s.due.next_due_on)}</span> : null}
                      </Td>
                      <Td className="num whitespace-nowrap text-xs">
                        {s.due?.km_left !== null && s.due?.km_left !== undefined ? <span className="block">{formatInt(s.due.km_left)} كم</span> : null}
                        {s.due?.days_left !== null && s.due?.days_left !== undefined ? <span className="block">{formatInt(s.due.days_left)} يوم</span> : null}
                      </Td>
                      <Td>{st ? <Badge tone={st.tone}>{st.label}</Badge> : <Badge>متوقفة</Badge>}</Td>
                      {canWrite ? (
                        <Td className="min-w-48">
                          <details>
                            <summary className="cursor-pointer text-sm text-primary">تعديل</summary>
                            <div className="mt-2 w-[min(90vw,56rem)] rounded-lg border border-border bg-surface p-3">
                              <ServiceScheduleForm
                                action={saveServiceSchedule.bind(null, s.id)}
                                trucks={options.trucks}
                                today={today}
                                initial={{
                                  truck_id: s.truck_id,
                                  service_name: s.service_name,
                                  interval_km: s.interval_km,
                                  interval_days: s.interval_days,
                                  last_done_odometer: s.last_done_odometer,
                                  last_done_on: s.last_done_on,
                                  is_active: s.is_active,
                                }}
                                submitLabel="حفظ"
                              />
                              <div className="mt-3 border-t border-border pt-3">
                                <ConfirmButton action={deleteServiceSchedule.bind(null, s.id)} label="حذف هذه الصيانة" confirmText="حذف جدول الصيانة؟" danger />
                              </div>
                            </div>
                          </details>
                        </Td>
                      ) : null}
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
