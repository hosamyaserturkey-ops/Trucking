"use client";

import { useState } from "react";
import type { OfficeExpenseState } from "@/app/(app)/expenses/actions";
import type { OfficeOptions } from "@/lib/office-options";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";
import { ReceiptInput, useReceiptAction } from "@/components/receipt-input";

const PAYMENTS: [string, string][] = [
  ["cash", "نقداً"],
  ["bank", "تحويل بنكي"],
  ["check", "شيك"],
  ["credit", "آجل على المورد"],
  ["driver_advance", "دفعها السائق من العهدة"],
];

export type ExpenseInitial = {
  cost_scope?: string;
  truck_id?: string | null;
  trip_id?: string | null;
  driver_id?: string | null;
  category_id?: string;
  supplier_id?: string | null;
  description?: string;
  expense_date?: string;
  currency?: string;
  fx_rate?: string;
  amount?: string;
  payment_method?: string;
  reference_no?: string | null;
  hasReceipt?: boolean;
};

/** Office expense: one truck's cost, or general overhead shared out by the company rule. */
export function OfficeExpenseForm({
  recordId,
  options,
  today,
  initial = {},
  action,
  submitLabel,
}: {
  recordId?: string;
  options: Pick<OfficeOptions, "trucks" | "drivers" | "trips" | "suppliers" | "categories" | "rates">;
  today: string;
  initial?: ExpenseInitial;
  action: (prev: OfficeExpenseState, formData: FormData) => Promise<OfficeExpenseState>;
  submitLabel: string;
}) {
  const { busy, uploading, pending, error, onSubmit } = useReceiptAction(action, "expense_receipt", recordId);
  const [scope, setScope] = useState(initial.cost_scope ?? "truck");
  const [truckId, setTruckId] = useState(initial.truck_id ?? "");
  const [driverId, setDriverId] = useState(initial.driver_id ?? "");
  const [currency, setCurrency] = useState(initial.currency ?? "JOD");
  const [fxRate, setFxRate] = useState(initial.fx_rate ?? options.rates[initial.currency ?? "JOD"] ?? "1");
  const trips = options.trips.filter((t) => t.truckId === truckId);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <fieldset className="flex flex-col gap-1 sm:col-span-2">
          <legend className="text-sm font-medium">على من يُحمّل المصروف؟</legend>
          <div className="flex flex-wrap gap-4 py-1 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="cost_scope" value="truck" checked={scope === "truck"} onChange={() => setScope("truck")} />
              شاحنة محددة
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="cost_scope" value="overhead" checked={scope === "overhead"} onChange={() => setScope("overhead")} />
              عام (يُوزّع على الأسطول)
            </label>
          </div>
        </fieldset>
        {scope === "truck" ? (
          <>
            <Field label={<>الشاحنة <span className="text-danger">*</span></>} htmlFor="truck_id">
              <Select
                id="truck_id"
                name="truck_id"
                value={truckId}
                onChange={(e) => {
                  setTruckId(e.target.value);
                  const t = options.trucks.find((x) => x.id === e.target.value);
                  if (t?.driverId) setDriverId(t.driverId);
                }}
                required
              >
                <option value="">اختر الشاحنة</option>
                {options.trucks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="الرحلة" htmlFor="trip_id">
              <Select id="trip_id" name="trip_id" defaultValue={initial.trip_id ?? ""} key={truckId}>
                <option value="">بدون رحلة</option>
                {trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="السائق" htmlFor="driver_id">
              <Select id="driver_id" name="driver_id" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">—</option>
                {options.drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        ) : null}
        <Field label={<>نوع المصروف <span className="text-danger">*</span></>} htmlFor="category_id">
          <Select id="category_id" name="category_id" defaultValue={initial.category_id ?? ""} required>
            <option value="">اختر</option>
            {options.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="المورد" htmlFor="supplier_id">
          <Select id="supplier_id" name="supplier_id" defaultValue={initial.supplier_id ?? ""}>
            <option value="">—</option>
            {options.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={<>البيان <span className="text-danger">*</span></>} htmlFor="description">
          <Input id="description" name="description" defaultValue={initial.description ?? ""} required />
        </Field>
        <Field label="التاريخ" htmlFor="expense_date">
          <Input id="expense_date" name="expense_date" type="date" dir="ltr" max={today} defaultValue={initial.expense_date ?? today} required />
        </Field>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label={<>المبلغ <span className="text-danger">*</span></>} htmlFor="amount">
            <Input id="amount" name="amount" inputMode="decimal" dir="ltr" defaultValue={initial.amount ?? ""} required />
          </Field>
          <Field label="العملة" htmlFor="currency">
            <Select
              id="currency"
              name="currency"
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value);
                setFxRate(options.rates[e.target.value] ?? "1");
              }}
            >
              <option value="JOD">دينار</option>
              <option value="USD">دولار</option>
            </Select>
          </Field>
        </div>
        {currency !== "JOD" ? (
          <Field label="سعر الصرف إلى الدينار" htmlFor="fx_rate">
            <Input id="fx_rate" name="fx_rate" inputMode="decimal" dir="ltr" value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
          </Field>
        ) : null}
        <Field label="طريقة الدفع" htmlFor="payment_method">
          <Select id="payment_method" name="payment_method" defaultValue={initial.payment_method ?? "cash"}>
            {PAYMENTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="رقم المرجع / الفاتورة" htmlFor="reference_no">
          <Input id="reference_no" name="reference_no" dir="ltr" defaultValue={initial.reference_no ?? ""} />
        </Field>
        <div className="sm:col-span-2">
          <ReceiptInput hasExisting={initial.hasReceipt} label="صورة الإيصال أو الفاتورة (اختياري)" />
        </div>
      </fieldset>
      <FormError message={error} />
      <div>
        <Button type="submit" disabled={busy}>
          {uploading ? "جارٍ رفع الصورة…" : pending ? "جارٍ الحفظ…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
