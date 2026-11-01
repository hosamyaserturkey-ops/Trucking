import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { daysBetween, todayIso } from "@/lib/date-range";
import { statementFilter } from "@/lib/ledger";
import { formatMoney, sumMinor } from "@/lib/money";
import { formatDate, formatInt } from "@/lib/format";
import { SERVICE_STATUS, WO_PAYMENT_METHOD, WORK_ORDER_KIND, WORK_ORDER_STATUS } from "@/lib/labels";
import { loadMaintenanceOptions } from "@/lib/maintenance-options";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { ExportButton } from "@/components/export-button";

export const metadata: Metadata = { title: "الصيانة" };

type SearchParams = Promise<{ from?: string; to?: string; truck?: string; status?: string; workshop?: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD = "rounded-lg border border-border bg-surface px-3 py-2 text-sm";

type Row = {
  id: string;
  wo_no: number;
  kind: string;
  status: string;
  opened_on: string;
  closed_on: string | null;
  odometer: number | null;
  description: string;
  invoice_no: string | null;
  payment_method: string | null;
  currency: string;
  total_minor: number;
  total_base_minor: number;
  truck: { id: string; code: string } | null;
  workshop: { name: string } | null;
};

/** Work orders across the fleet: who is in the workshop now, services due, and every order in a period. */
export default async function MaintenancePage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(...STAFF_ROLES);
  const sp = await searchParams;
  const f = statementFilter(sp);
  const truck = sp.truck && UUID.test(sp.truck) ? sp.truck : "";
  const workshop = sp.workshop && UUID.test(sp.workshop) ? sp.workshop : "";
  const status = sp.status && WORK_ORDER_STATUS[sp.status] ? sp.status : "";
  const today = todayIso();
  const supabase = await createClient();

  const fields =
    "id, wo_no, kind, status, opened_on, closed_on, odometer, description, invoice_no, payment_method, currency, total_minor, total_base_minor, truck:trucks(id, code), workshop:suppliers(name)";
  let q = supabase
    .from("work_orders")
    .select(fields)
    .or(`and(opened_on.gte.${f.from},opened_on.lte.${f.to}),and(closed_on.gte.${f.from},closed_on.lte.${f.to})`)
    .order("opened_on", { ascending: false })
    .order("wo_no", { ascending: false })
    .limit(500);
  if (truck) q = q.eq("truck_id", truck);
  if (workshop) q = q.eq("workshop_id", workshop);
  if (status) q = q.eq("status", status as "open" | "closed" | "cancelled");

  const [rowsRes, openRes, dueRes, options] = await Promise.all([
    q,
    supabase.from("work_orders").select(fields).eq("status", "open").order("opened_on"),
    supabase
      .from("service_due_v")
      .select("id, truck_id, service_name, km_left, days_left, next_due_on, due_status")
      .in("due_status", ["overdue", "due_soon"])
      .order("due_status", { ascending: false }),
    loadMaintenanceOptions({ truckId: truck, workshopId: workshop }),
  ]);
  const rows = (rowsRes.data ?? []) as unknown as Row[];
  const open = (openRes.data ?? []) as unknown as Row[];
  const due = dueRes.data ?? [];
  const codeById = new Map(options.trucks.map((t) => [t.id, t.label.split(" · ")[0]]));
  const closedInPeriod = rows.filter((r) => r.status === "closed" && r.closed_on && r.closed_on >= f.from && r.closed_on <= f.to);
  const overdue = due.filter((d) => d.due_status === "overdue").length;
  const query = new URLSearchParams({ from: f.from, to: f.to });

  return (
    <>
      <PageHeader
        title="الصيانة وأوامر العمل"
        subtitle="تُفتح الأوامر عند دخول الشاحنة للورشة، ويغلقها المدير أو المحاسب عند استلام فاتورة الورشة فتُرحّل"
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/maintenance/schedules" className={buttonClass("secondary")}>
              الصيانة الدورية
            </Link>
            <Link href="/maintenance/new" className={buttonClass("primary")}>
              <Plus className="size-4" aria-hidden />
              أمر صيانة جديد
            </Link>
          </div>
        }
      />
      <div className="flex flex-col gap-5">
        <StatGrid>
          <Stat label="أوامر مفتوحة" value={formatInt(open.length)} tone={open.length ? "warning" : "neutral"} hint="شاحنات في الورشة الآن" />
          <Stat label="صيانة دورية متأخرة" value={formatInt(overdue)} tone={overdue ? "danger" : "success"} hint={`${formatInt(due.length - overdue)} قريبة`} />
          <Stat label="أوامر أُغلقت في الفترة" value={formatInt(closedInPeriod.length)} />
          <Stat
            label="تكلفة الصيانة في الفترة"
            value={formatMoney(sumMinor(closedInPeriod.map((r) => r.total_base_minor)), "JOD", { fractionDigits: 0 })}
            hint="الأوامر المغلقة فقط"
          />
        </StatGrid>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader title="في الورشة الآن" subtitle="الأوامر المفتوحة، الأقدم أولاً" />
            {open.length === 0 ? (
              <EmptyState>لا توجد أوامر صيانة مفتوحة.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {open.map((o) => (
                  <li key={o.id}>
                    <Link href={`/maintenance/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2">
                      <span className="min-w-0">
                        <span className="num font-semibold">{o.truck?.code}</span> <span>{o.description}</span>
                        <span className="block text-xs text-muted">
                          <span className="num">#{o.wo_no}</span> · {o.workshop?.name ?? "بدون ورشة"} · منذ{" "}
                          <span className="num">{formatInt(daysBetween(o.opened_on, today))}</span> يوم
                        </span>
                      </span>
                      <span className="num whitespace-nowrap font-semibold">{formatMoney(o.total_minor, o.currency)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="صيانة دورية مستحقة"
              subtitle="المتأخرة والقريبة (خلال 2,000 كم أو 14 يوماً)"
              action={
                <Link href="/maintenance/schedules" className="text-xs text-primary hover:underline">
                  الكل
                </Link>
              }
            />
            {due.length === 0 ? (
              <EmptyState>لا توجد صيانة مستحقة.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {due.map((s) => {
                  const st = SERVICE_STATUS[s.due_status ?? "ok"];
                  return (
                    <li key={s.id}>
                      <Link
                        href={`/maintenance/new?truck=${s.truck_id}&kind=service&service=${encodeURIComponent(s.service_name ?? "")}`}
                        className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-surface-2"
                        title="فتح أمر صيانة لهذه الخدمة"
                      >
                        <span className="min-w-0">
                          <span className="num font-semibold">{codeById.get(s.truck_id ?? "") ?? ""}</span> <span>{s.service_name}</span>
                          <span className="block text-xs text-muted">
                            {s.km_left !== null ? (
                              <>
                                متبقي <span className="num">{formatInt(s.km_left)}</span> كم
                              </>
                            ) : null}
                            {s.km_left !== null && s.days_left !== null ? " · " : null}
                            {s.days_left !== null ? (
                              <>
                                <span className="num">{formatDate(s.next_due_on)}</span>
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
        </div>

        <form action="/maintenance" className="flex flex-wrap items-end gap-2 text-sm">
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
          <label className="flex flex-col gap-1 text-xs text-muted">
            الورشة
            <select name="workshop" defaultValue={workshop} className={FIELD}>
              <option value="">الكل</option>
              {options.workshops.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            الحالة
            <select name="status" defaultValue={status} className={FIELD}>
              <option value="">الكل</option>
              {Object.entries(WORK_ORDER_STATUS).map(([value, s]) => (
                <option key={value} value={value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            من
            <input type="date" name="from" defaultValue={f.from} className={FIELD} dir="ltr" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            إلى
            <input type="date" name="to" defaultValue={f.to} className={FIELD} dir="ltr" />
          </label>
          <button type="submit" className={buttonClass("secondary")}>
            عرض
          </button>
        </form>

        <Card>
          <CardHeader
            title="أوامر الصيانة"
            subtitle={`${formatInt(rows.length)} أمر فُتح أو أُغلق من ${formatDate(f.from)} إلى ${formatDate(f.to)}`}
            action={<ExportButton tableId="work-orders-table" file="work-orders" title={`أوامر الصيانة من ${formatDate(f.from)} إلى ${formatDate(f.to)}`} />}
          />
          {rows.length === 0 ? (
            <EmptyState>لا توجد أوامر صيانة في هذه الفترة.</EmptyState>
          ) : (
            <Table id="work-orders-table">
              <thead>
                <tr>
                  <Th>رقم الأمر</Th>
                  <Th>الشاحنة</Th>
                  <Th>العمل</Th>
                  <Th>النوع</Th>
                  <Th>الورشة</Th>
                  <Th>الفتح</Th>
                  <Th>الإغلاق</Th>
                  <Th>الدفع</Th>
                  <Th>فاتورة الورشة</Th>
                  <Th className="text-end">المبلغ (دينار)</Th>
                  <Th>الحالة</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = WORK_ORDER_STATUS[r.status];
                  return (
                    <Tr key={r.id} className={r.status === "cancelled" ? "text-muted" : ""}>
                      <Td className="num font-semibold">
                        <Link href={`/maintenance/${r.id}`} className="hover:underline">
                          {r.wo_no}
                        </Link>
                      </Td>
                      <Td className="num whitespace-nowrap">
                        {r.truck ? (
                          <Link href={`/maintenance?${query}&truck=${r.truck.id}`} className="hover:underline">
                            {r.truck.code}
                          </Link>
                        ) : null}
                      </Td>
                      <Td>
                        <Link href={`/maintenance/${r.id}`} className="hover:underline">
                          {r.description}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap">{WORK_ORDER_KIND[r.kind]}</Td>
                      <Td className="whitespace-nowrap">{r.workshop?.name ?? "—"}</Td>
                      <Td className="num whitespace-nowrap">{formatDate(r.opened_on)}</Td>
                      <Td className="num whitespace-nowrap">{formatDate(r.closed_on)}</Td>
                      <Td className="whitespace-nowrap">{r.status === "closed" && r.payment_method ? WO_PAYMENT_METHOD[r.payment_method] : "—"}</Td>
                      <Td className="num">
                        <span dir="ltr">{r.invoice_no ?? "—"}</span>
                      </Td>
                      <Td className="num whitespace-nowrap text-end font-semibold">
                        {formatMoney(r.total_base_minor, "JOD", { withCurrency: false })}
                      </Td>
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
      </div>
    </>
  );
}
