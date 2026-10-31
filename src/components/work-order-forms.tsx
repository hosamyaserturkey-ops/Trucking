"use client";

import { useActionState, useState } from "react";
import type { WorkOrderFormState } from "@/app/(app)/maintenance/actions";
import { formatMoney, parseMoney } from "@/lib/money";
import { formatInt } from "@/lib/format";
import { WO_PAYMENT_METHOD, WORK_ORDER_KIND, WORK_ORDER_LINE_TYPE, SERVICE_STATUS } from "@/lib/labels";
import { lineTotal } from "@/lib/work-orders";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { ReceiptInput, useReceiptAction } from "@/components/receipt-input";

type Action = (prev: WorkOrderFormState, formData: FormData) => Promise<WorkOrderFormState>;
type Option = { id: string; label: string };
type TruckOption = Option & { odometer: number | null };

/** A new key after each success clears the inputs. */
function useResetOnDone(state: WorkOrderFormState) {
  const [round, setRound] = useState(0);
  const [last, setLast] = useState<WorkOrderFormState | null>(null);
  if (state.done && state !== last) {
    setLast(state);
    setRound((r) => r + 1);
  }
  return round;
}

export type WorkOrderInitial = {
  truck_id?: string;
  workshop_id?: string | null;
  kind?: string;
  opened_on?: string;
  odometer?: number | null;
  description?: string;
  invoice_no?: string | null;
  notes?: string | null;
};

/** The order's header: truck, workshop, kind, date, odometer, what is being done. */
export function WorkOrderForm({
  action,
  trucks,
  workshops,
  today,
  initial = {},
  submitLabel,
}: {
  action: Action;
  trucks: TruckOption[];
  workshops: Option[];
  today: string;
  initial?: WorkOrderInitial;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [truck, setTruck] = useState(initial.truck_id ?? "");
  const odo = trucks.find((t) => t.id === truck)?.odometer;
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="الشاحنة" htmlFor="wo_truck">
          <Select id="wo_truck" name="truck_id" required value={truck} onChange={(e) => setTruck(e.target.value)}>
            <option value="">اختر الشاحنة</option>
            {trucks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="الورشة / المورد" htmlFor="wo_workshop" hint="مطلوبة لتسجيل الفاتورة آجلاً على حسابها">
          <Select id="wo_workshop" name="workshop_id" defaultValue={initial.workshop_id ?? ""}>
            <option value="">بدون</option>
            {workshops.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="نوع الصيانة" htmlFor="wo_kind">
          <Select id="wo_kind" name="kind" defaultValue={initial.kind ?? "repair"}>
            {Object.entries(WORK_ORDER_KIND).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="تاريخ الدخول للورشة" htmlFor="wo_opened">
          <Input id="wo_opened" name="opened_on" type="date" dir="ltr" max={today} defaultValue={initial.opened_on ?? today} />
        </Field>
        <Field label="قراءة العداد (كم)" htmlFor="wo_odo" hint={odo ? `آخر قراءة معروفة: ${formatInt(odo)} كم` : "مطلوبة لتسجيل الصيانة الدورية بالكيلومترات"}>
          <Input id="wo_odo" name="odometer" inputMode="numeric" dir="ltr" defaultValue={initial.odometer ?? ""} />
        </Field>
        <Field label="رقم فاتورة الورشة" htmlFor="wo_invoice">
          <Input id="wo_invoice" name="invoice_no" dir="ltr" defaultValue={initial.invoice_no ?? ""} />
        </Field>
        <div className="sm:col-span-3">
          <Field label="العمل المطلوب" htmlFor="wo_desc">
            <Input id="wo_desc" name="description" required maxLength={200} defaultValue={initial.description ?? ""} placeholder="مثال: تبديل فحمات الفرامل" />
          </Field>
        </div>
        <div className="sm:col-span-3">
          <Field label="ملاحظات" htmlFor="wo_notes">
            <Input id="wo_notes" name="notes" maxLength={500} defaultValue={initial.notes ?? ""} />
          </Field>
        </div>
      </div>
      <FormError message={state.error} />
      {state.done ? (
        <p role="status" className="text-sm text-success">
          تم الحفظ.
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Add a part, labour, tire or other line; the total shows as you type. */
export function WorkOrderLineForm({ action, currency }: { action: Action; currency: string }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [round, setRound] = useState(0);
  const [last, setLast] = useState<WorkOrderFormState | null>(null);
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  // Cleared only once the line is saved; on an error what was typed stays.
  if (state.done && state !== last) {
    setLast(state);
    setRound((r) => r + 1);
    setQty("1");
    setPrice("");
  }
  const parsedPrice = parseMoney(price, "JOD");
  const q = Number(qty.replace(/,/g, ""));
  const total = parsedPrice !== null && q > 0 ? lineTotal(q, Number(parsedPrice)) : null;
  return (
    <form key={round} action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-6">
        <Field label="النوع" htmlFor="ln_type">
          <Select id="ln_type" name="line_type" defaultValue="part">
            {Object.entries(WORK_ORDER_LINE_TYPE).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="البيان" htmlFor="ln_desc">
            <Input id="ln_desc" name="description" required maxLength={200} />
          </Field>
        </div>
        <Field label="رقم القطعة" htmlFor="ln_part">
          <Input id="ln_part" name="part_number" dir="ltr" maxLength={40} />
        </Field>
        <Field label="الكمية" htmlFor="ln_qty">
          <Input id="ln_qty" name="quantity" inputMode="decimal" dir="ltr" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="سعر الوحدة (دينار)" htmlFor="ln_price" hint={total !== null ? `المجموع: ${formatMoney(total, currency)}` : undefined}>
          <Input id="ln_price" name="unit_price" inputMode="decimal" dir="ltr" required value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
      </div>
      <FormError message={state.error} />
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "جارٍ الإضافة…" : "إضافة البند"}
        </Button>
      </div>
    </form>
  );
}

export type ScheduleChoice = { id: string; name: string; status: string | null; detail: string };

/** Close with the workshop's invoice: the day, how it is paid, and the services done. */
export function CloseWorkOrderForm({
  action,
  today,
  openedOn,
  hasWorkshop,
  invoiceNo,
  schedules,
  total,
}: {
  action: Action;
  today: string;
  openedOn: string;
  hasWorkshop: boolean;
  invoiceNo: string | null;
  schedules: ScheduleChoice[];
  total: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [method, setMethod] = useState(hasWorkshop ? "credit" : "cash");
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(`إغلاق أمر الصيانة وترحيل ${total}؟ لا تتغير بنوده بعد الإغلاق.`)) e.preventDefault();
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="تاريخ الإغلاق (فاتورة الورشة)" htmlFor="cl_date">
          <Input id="cl_date" name="closed_on" type="date" dir="ltr" min={openedOn} max={today} defaultValue={today} />
        </Field>
        <Field label="رقم فاتورة الورشة" htmlFor="cl_invoice">
          <Input id="cl_invoice" name="invoice_no" dir="ltr" defaultValue={invoiceNo ?? ""} />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">طريقة الدفع</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {Object.entries(WO_PAYMENT_METHOD).map(([value, label]) => (
            <label
              key={value}
              className={`flex cursor-pointer items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-medium has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary ${
                value === "credit" && !hasWorkshop ? "pointer-events-none opacity-50" : ""
              }`}
            >
              <input
                type="radio"
                name="payment_method"
                value={value}
                checked={method === value}
                disabled={value === "credit" && !hasWorkshop}
                onChange={() => setMethod(value)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
        {!hasWorkshop ? <p className="text-xs text-muted">لتسجيل الفاتورة آجلاً اختر الورشة في بيانات الأمر أولاً.</p> : null}
      </fieldset>
      {method === "cash" ? (
        <Field label="رقم سند الصرف" htmlFor="cl_voucher">
          <Input id="cl_voucher" name="voucher_no" dir="ltr" className="sm:max-w-xs" />
        </Field>
      ) : null}
      {method === "bank" ? (
        <Field label="رقم الإشعار / الحوالة" htmlFor="cl_notice">
          <Input id="cl_notice" name="notice_no" dir="ltr" className="sm:max-w-xs" />
        </Field>
      ) : null}
      {schedules.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">الصيانة الدورية التي تمت في هذا الأمر</legend>
          {schedules.map((s) => {
            const st = s.status ? SERVICE_STATUS[s.status] : null;
            return (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="schedule_id" value={s.id} className="size-4" />
                <span>{s.name}</span>
                {st ? <Badge tone={st.tone}>{st.label}</Badge> : null}
                <span className="text-xs text-muted">{s.detail}</span>
              </label>
            );
          })}
          <p className="text-xs text-muted">تُسجّل كمنجزة بتاريخ الإغلاق وقراءة عداد الأمر، فيبدأ عدّ موعدها التالي منها.</p>
        </fieldset>
      ) : null}
      <FormError message={state.error} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "جارٍ الإغلاق…" : "إغلاق الأمر وترحيله"}
        </Button>
      </div>
    </form>
  );
}

/** Cancel an open order, with the reason. */
export function CancelWorkOrderForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <Field label="سبب الإلغاء" htmlFor="cn_reason">
            <Input id="cn_reason" name="cancel_reason" required maxLength={300} />
          </Field>
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "…" : "إلغاء الأمر"}
        </Button>
      </div>
      <FormError message={state.error} />
    </form>
  );
}

/** One button with a confirmation: reopen, delete, delete a line. */
export function ConfirmButton({
  action,
  label,
  confirmText,
  danger = false,
}: {
  action: (prev: WorkOrderFormState) => Promise<WorkOrderFormState>;
  label: string;
  confirmText: string;
  danger?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(confirmText)) e.preventDefault();
      }}
      className="inline"
    >
      <button type="submit" disabled={pending} className={`text-sm hover:underline ${danger ? "text-danger" : "text-primary"}`}>
        {pending ? "…" : label}
      </button>
      {state.error ? <span className="ms-2 text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

/** On a closed order: the invoice number and notes only. */
export function WorkOrderNotesForm({ action, invoiceNo, notes }: { action: Action; invoiceNo: string | null; notes: string | null }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="رقم فاتورة الورشة" htmlFor="nt_invoice">
          <Input id="nt_invoice" name="invoice_no" dir="ltr" defaultValue={invoiceNo ?? ""} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="ملاحظات" htmlFor="nt_notes">
            <Input id="nt_notes" name="notes" maxLength={500} defaultValue={notes ?? ""} />
          </Field>
        </div>
      </div>
      <FormError message={state.error} />
      {state.done ? (
        <p role="status" className="text-sm text-success">
          تم الحفظ.
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : "حفظ"}
        </Button>
      </div>
    </form>
  );
}

/** Attach or replace the scan of the workshop's invoice (PDF or photo). */
export function WorkOrderInvoiceForm({ action, workOrderId, hasFile }: { action: Action; workOrderId: string; hasFile: boolean }) {
  const { busy, uploading, pending, error, onSubmit } = useReceiptAction(action, "work_order_invoice", workOrderId);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <fieldset disabled={busy}>
        <ReceiptInput label={hasFile ? "استبدال صورة الفاتورة" : "صورة فاتورة الورشة (PDF أو صورة)"} document />
      </fieldset>
      <FormError message={error} />
      <div>
        <Button type="submit" variant="secondary" disabled={busy}>
          {uploading ? "جارٍ رفع الملف…" : pending ? "جارٍ الحفظ…" : "إرفاق الفاتورة"}
        </Button>
      </div>
    </form>
  );
}

export type ScheduleInitial = {
  truck_id?: string;
  service_name?: string;
  interval_km?: number | null;
  interval_days?: number | null;
  last_done_odometer?: number | null;
  last_done_on?: string | null;
  is_active?: boolean;
};

/** A periodic service for a truck: every so many km and/or days. */
export function ServiceScheduleForm({
  action,
  trucks,
  today,
  initial = {},
  submitLabel,
}: {
  action: Action;
  trucks: TruckOption[];
  today: string;
  initial?: ScheduleInitial;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const round = useResetOnDone(state);
  const editing = !!initial.service_name;
  return (
    <form key={round} action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="الشاحنة" htmlFor={`sc_truck_${round}`}>
          <Select id={`sc_truck_${round}`} name="truck_id" required defaultValue={initial.truck_id ?? ""}>
            <option value="">اختر</option>
            {trucks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="الصيانة" htmlFor={`sc_name_${round}`}>
          <Input id={`sc_name_${round}`} name="service_name" required maxLength={80} defaultValue={initial.service_name ?? ""} placeholder="تغيير زيت المحرك" />
        </Field>
        <Field label="كل (كم)" htmlFor={`sc_km_${round}`}>
          <Input id={`sc_km_${round}`} name="interval_km" inputMode="numeric" dir="ltr" defaultValue={initial.interval_km ?? ""} />
        </Field>
        <Field label="كل (يوم)" htmlFor={`sc_days_${round}`}>
          <Input id={`sc_days_${round}`} name="interval_days" inputMode="numeric" dir="ltr" defaultValue={initial.interval_days ?? ""} />
        </Field>
        <Field label="آخر مرة عند (كم)" htmlFor={`sc_lastkm_${round}`}>
          <Input id={`sc_lastkm_${round}`} name="last_done_odometer" inputMode="numeric" dir="ltr" defaultValue={initial.last_done_odometer ?? ""} />
        </Field>
        <Field label="آخر مرة بتاريخ" htmlFor={`sc_laston_${round}`}>
          <Input id={`sc_laston_${round}`} name="last_done_on" type="date" dir="ltr" max={today} defaultValue={initial.last_done_on ?? ""} />
        </Field>
      </div>
      {editing ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_active" value="on" defaultChecked={initial.is_active ?? true} className="size-4" />
          {/* Comes after the checkbox: the form reads the first value, "off" only when unticked. */}
          <input type="hidden" name="is_active" value="off" />
          فعّالة (تظهر في التنبيهات)
        </label>
      ) : null}
      <FormError message={state.error} />
      {state.done && editing ? (
        <p role="status" className="text-sm text-success">
          تم الحفظ.
        </p>
      ) : null}
      <div>
        <Button type="submit" variant={editing ? "secondary" : "primary"} disabled={pending}>
          {pending ? "جارٍ الحفظ…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
