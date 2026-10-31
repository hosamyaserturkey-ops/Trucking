import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, FileText } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { canSeeFinancials, STAFF_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { daysBetween, todayIso } from "@/lib/date-range";
import { formatMoney, sumMinor } from "@/lib/money";
import { formatDate, formatDateTime, formatDecimal, formatInt } from "@/lib/format";
import { WO_PAYMENT_METHOD, WORK_ORDER_KIND, WORK_ORDER_LINE_TYPE, WORK_ORDER_STATUS } from "@/lib/labels";
import { loadMaintenanceOptions } from "@/lib/maintenance-options";
import {
  addWorkOrderLine,
  attachWorkOrderInvoice,
  cancelWorkOrder,
  closeWorkOrder,
  deleteWorkOrder,
  deleteWorkOrderLine,
  reopenWorkOrder,
  updateWorkOrder,
  updateWorkOrderNotes,
} from "../actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { JournalEntryCard } from "@/components/journal-entry-card";
import {
  CancelWorkOrderForm,
  CloseWorkOrderForm,
  ConfirmButton,
  WorkOrderForm,
  WorkOrderInvoiceForm,
  WorkOrderLineForm,
  WorkOrderNotesForm,
  type ScheduleChoice,
} from "@/components/work-order-forms";

export const metadata: Metadata = { title: "أمر صيانة" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Line = {
  id: string;
  line_type: string;
  description: string;
  part_number: string | null;
  quantity: number;
  unit_price_minor: number;
  line_total_minor: number;
  created_at: string;
};

export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole(...STAFF_ROLES);
  const finance = canSeeFinancials(profile.role);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const { data: wo } = await supabase
    .from("work_orders")
    .select(
      "id, wo_no, truck_id, workshop_id, kind, status, opened_on, closed_on, odometer, description, invoice_no, invoice_path, payment_method, voucher_no, notice_no, notes, cancel_reason, currency, total_minor, total_base_minor, updated_at, truck:trucks(code, plate_number), workshop:suppliers(name), lines:work_order_lines(id, line_type, description, part_number, quantity, unit_price_minor, line_total_minor, created_at)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!wo) notFound();

  const today = todayIso();
  const [options, schedulesRes] = await Promise.all([
    loadMaintenanceOptions({ truckId: wo.truck_id, workshopId: wo.workshop_id }),
    supabase
      .from("service_due_v")
      .select("id, service_name, interval_km, interval_days, km_left, next_due_on, due_status")
      .eq("truck_id", wo.truck_id)
      .order("service_name"),
  ]);
  const truck = wo.truck as unknown as { code: string; plate_number: string } | null;
  const workshop = (wo.workshop as unknown as { name: string } | null)?.name ?? null;
  const lines = [...((wo.lines ?? []) as unknown as Line[])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const st = WORK_ORDER_STATUS[wo.status];
  const isOpen = wo.status === "open";
  const byType = (t: string) => sumMinor(lines.filter((l) => l.line_type === t).map((l) => l.line_total_minor));
  const total = formatMoney(wo.total_minor, wo.currency);
  const schedules: ScheduleChoice[] = (schedulesRes.data ?? []).map((s) => ({
    id: s.id!,
    name: s.service_name ?? "",
    status: s.due_status,
    detail: [
      s.interval_km ? `كل ${formatInt(s.interval_km)} كم (متبقي ${formatInt(s.km_left)})` : null,
      s.interval_days ? `موعدها ${formatDate(s.next_due_on)}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  return (
    <>
      <Link href="/maintenance" className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        الصيانة
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            أمر صيانة <span className="num">#{wo.wo_no}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
          </span>
        }
        subtitle={
          <>
            <Link href={`/trucks/${wo.truck_id}/maintenance`} className="num font-medium hover:underline">
              {truck?.code} · {truck?.plate_number}
            </Link>{" "}
            · {WORK_ORDER_KIND[wo.kind]} · {wo.description}
          </>
        }
      />

      <div className="flex flex-col gap-5">
        <Card>
          <CardBody>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              <dt className="text-muted">الورشة</dt>
              <dd>{workshop ?? "—"}</dd>
              <dt className="text-muted">دخول الورشة</dt>
              <dd className="num">{formatDate(wo.opened_on)}</dd>
              <dt className="text-muted">قراءة العداد</dt>
              <dd className="num">{wo.odometer ? `${formatInt(wo.odometer)} كم` : "—"}</dd>
              <dt className="text-muted">{isOpen ? "في الورشة منذ" : "الإغلاق"}</dt>
              <dd className="num">{isOpen ? `${formatInt(daysBetween(wo.opened_on, today))} يوم` : formatDate(wo.closed_on)}</dd>
              <dt className="text-muted">فاتورة الورشة</dt>
              <dd className="num" dir="ltr">
                {wo.invoice_no ?? "—"}
              </dd>
              {wo.status === "closed" ? (
                <>
                  <dt className="text-muted">الدفع</dt>
                  <dd>
                    {wo.payment_method ? WO_PAYMENT_METHOD[wo.payment_method] : "—"}
                    {wo.voucher_no ? (
                      <span className="text-xs text-muted">
                        {" "}
                        · سند صرف <span className="num">{wo.voucher_no}</span>
                      </span>
                    ) : null}
                    {wo.notice_no ? (
                      <span className="text-xs text-muted">
                        {" "}
                        · إشعار <span className="num">{wo.notice_no}</span>
                      </span>
                    ) : null}
                  </dd>
                </>
              ) : null}
              <dt className="text-muted">المجموع</dt>
              <dd className="num font-semibold">{total}</dd>
              <dt className="text-muted">آخر تعديل</dt>
              <dd className="num text-xs">{formatDateTime(wo.updated_at)}</dd>
            </dl>
            {wo.status === "cancelled" ? (
              <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">سبب الإلغاء: {wo.cancel_reason}</p>
            ) : null}
            {wo.notes ? <p className="mt-3 text-sm text-muted">ملاحظات: {wo.notes}</p> : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="البنود"
            subtitle={`قطع ${formatMoney(byType("part"), wo.currency)} · أجور ${formatMoney(byType("labor"), wo.currency)} · إطارات ${formatMoney(
              byType("tire"),
              wo.currency,
            )}${byType("other") ? ` · أخرى ${formatMoney(byType("other"), wo.currency)}` : ""}`}
          />
          {lines.length === 0 ? (
            <EmptyState>لا توجد بنود بعد. أضف القطع والأجور من النموذج أدناه.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>النوع</Th>
                  <Th>البيان</Th>
                  <Th>رقم القطعة</Th>
                  <Th className="text-end">الكمية</Th>
                  <Th className="text-end">سعر الوحدة</Th>
                  <Th className="text-end">المجموع</Th>
                  {isOpen ? (
                    <Th>
                      <span className="sr-only">إجراءات</span>
                    </Th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <Tr key={l.id}>
                    <Td className="whitespace-nowrap">{WORK_ORDER_LINE_TYPE[l.line_type] ?? l.line_type}</Td>
                    <Td>{l.description}</Td>
                    <Td className="num">
                      <span dir="ltr">{l.part_number ?? "—"}</span>
                    </Td>
                    <Td className="num text-end">{formatDecimal(l.quantity, Number.isInteger(l.quantity) ? 0 : 2)}</Td>
                    <Td className="num text-end">{formatMoney(l.unit_price_minor, wo.currency, { withCurrency: false })}</Td>
                    <Td className="num text-end font-semibold">{formatMoney(l.line_total_minor, wo.currency, { withCurrency: false })}</Td>
                    {isOpen ? (
                      <Td>
                        <ConfirmButton action={deleteWorkOrderLine.bind(null, wo.id, l.id)} label="حذف" confirmText="حذف هذا البند؟" danger />
                      </Td>
                    ) : null}
                  </Tr>
                ))}
                <tr className="font-semibold">
                  <Td className="text-end" />
                  <Td>المجموع</Td>
                  <Td />
                  <Td />
                  <Td />
                  <Td className="num text-end">{formatMoney(wo.total_minor, wo.currency, { withCurrency: false })}</Td>
                  {isOpen ? <Td /> : null}
                </tr>
              </tbody>
            </Table>
          )}
          {isOpen ? (
            <div className="border-t border-border p-4">
              <WorkOrderLineForm action={addWorkOrderLine.bind(null, wo.id)} currency={wo.currency} />
            </div>
          ) : null}
        </Card>

        {isOpen && finance ? (
          <Card>
            <CardHeader
              title="إغلاق الأمر"
              subtitle="عند استلام فاتورة الورشة: يُرحّل مدين الصيانة (والإطارات) على الشاحنة، دائن حساب الورشة أو الصندوق أو البنك"
            />
            <CardBody>
              {lines.length === 0 ? (
                <p className="text-sm text-muted">أضف بنود الأمر قبل إغلاقه.</p>
              ) : (
                <CloseWorkOrderForm
                  action={closeWorkOrder.bind(null, wo.id)}
                  today={today}
                  openedOn={wo.opened_on}
                  hasWorkshop={!!wo.workshop_id}
                  invoiceNo={wo.invoice_no}
                  schedules={schedules}
                  total={total}
                />
              )}
            </CardBody>
          </Card>
        ) : null}
        {isOpen && !finance ? (
          <p className="rounded-lg bg-info-soft px-4 py-3 text-sm text-info">يغلق المدير أو المحاسب الأمر عند استلام فاتورة الورشة، فيُرحّل إلى الحسابات.</p>
        ) : null}

        {wo.status !== "cancelled" ? (
          <Card>
            <CardHeader
              title="فاتورة الورشة"
              action={
                wo.invoice_path ? (
                  <a href={`/files/work-order/${wo.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    <FileText className="size-4" aria-hidden />
                    فتح الفاتورة المرفقة
                  </a>
                ) : null
              }
            />
            <CardBody className="flex flex-col gap-5">
              {!isOpen ? (
                <WorkOrderNotesForm action={updateWorkOrderNotes.bind(null, wo.id)} invoiceNo={wo.invoice_no} notes={wo.notes} />
              ) : null}
              <WorkOrderInvoiceForm action={attachWorkOrderInvoice.bind(null, wo.id)} workOrderId={wo.id} hasFile={!!wo.invoice_path} />
            </CardBody>
          </Card>
        ) : null}

        {isOpen ? (
          <Card>
            <CardHeader title="بيانات الأمر" subtitle="تتغير ما دام الأمر مفتوحاً" />
            <CardBody>
              <WorkOrderForm
                action={updateWorkOrder.bind(null, wo.id)}
                trucks={options.trucks}
                workshops={options.workshops}
                today={today}
                initial={{
                  truck_id: wo.truck_id,
                  workshop_id: wo.workshop_id,
                  kind: wo.kind,
                  opened_on: wo.opened_on,
                  odometer: wo.odometer,
                  description: wo.description,
                  invoice_no: wo.invoice_no,
                  notes: wo.notes,
                }}
                submitLabel="حفظ التعديلات"
              />
            </CardBody>
          </Card>
        ) : null}

        {isOpen ? (
          <Card>
            <CardHeader title="إلغاء أو حذف" subtitle="الإلغاء يبقي الأمر في السجل بسببه؛ الحذف للأوامر المفتوحة بالخطأ" />
            <CardBody className="flex flex-col gap-4">
              <CancelWorkOrderForm action={cancelWorkOrder.bind(null, wo.id)} />
              <div>
                <ConfirmButton action={deleteWorkOrder.bind(null, wo.id)} label="حذف الأمر نهائياً" confirmText="حذف أمر الصيانة وبنوده نهائياً؟" danger />
              </div>
            </CardBody>
          </Card>
        ) : null}

        {wo.status === "closed" && finance ? (
          <Card>
            <CardHeader title="تصحيح أمر مغلق" subtitle="إعادة الفتح تعكس القيد؛ عدّل البنود ثم أغلقه من جديد" />
            <CardBody>
              <ConfirmButton
                action={reopenWorkOrder.bind(null, wo.id)}
                label="إعادة فتح الأمر"
                confirmText="إعادة فتح أمر الصيانة؟ سيُعكس قيده حتى يُغلق من جديد."
              />
            </CardBody>
          </Card>
        ) : null}

        {finance ? (
          <JournalEntryCard
            sourceType="work_order"
            sourceId={wo.id}
            subtitle="يُرحّل عند إغلاق الأمر؛ إعادة فتحه تعكس القيد"
            empty="لا يوجد قيد؛ يُرحّل عند إغلاق الأمر."
          />
        ) : null}
      </div>
    </>
  );
}
