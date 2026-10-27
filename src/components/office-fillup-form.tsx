"use client";

import { useState } from "react";
import type { FillupFormState } from "@/app/(app)/diesel/actions";
import type { OfficeOptions } from "@/lib/office-options";
import { formatMoney, parseMoney } from "@/lib/money";
import { pricePerLiter } from "@/lib/fuel";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";
import { ReceiptInput, useReceiptAction } from "@/components/receipt-input";

const PAYMENTS: [string, string][] = [
  ["cash", "نقداً"],
  ["card", "بطاقة"],
  ["credit", "آجل على حساب المحطة"],
  ["driver_advance", "دفعها السائق من العهدة"],
];

export type FillupInitial = {
  truck_id?: string;
  driver_id?: string | null;
  trip_id?: string | null;
  station_id?: string | null;
  filled_on?: string;
  filled_time?: string;
  odometer?: string;
  liters?: string;
  is_full_tank?: boolean;
  currency?: string;
  fx_rate?: string;
  amount?: string;
  payment_method?: string;
  notes?: string | null;
  hasReceipt?: boolean;
};

/** Office form for a fill-up: any truck, driver and payment; the receipt is optional. */
export function OfficeFillupForm({
  recordId,
  options,
  today,
  time,
  initial = {},
  action,
  submitLabel,
  note,
}: {
  recordId?: string;
  options: Pick<OfficeOptions, "trucks" | "drivers" | "trips" | "stations" | "rates">;
  today: string;
  time: string;
  initial?: FillupInitial;
  action: (prev: FillupFormState, formData: FormData) => Promise<FillupFormState>;
  submitLabel: string;
  note?: string;
}) {
  const { busy, uploading, pending, error, onSubmit } = useReceiptAction(action, "fuel_receipt", recordId);
  const [truckId, setTruckId] = useState(initial.truck_id ?? "");
  const [driverId, setDriverId] = useState(initial.driver_id ?? "");
  const [currency, setCurrency] = useState(initial.currency ?? "JOD");
  const [fxRate, setFxRate] = useState(initial.fx_rate ?? options.rates[initial.currency ?? "JOD"] ?? "1");
  const [amount, setAmount] = useState(initial.amount ?? "");
  const [liters, setLiters] = useState(initial.liters ?? "");

  const truck = options.trucks.find((t) => t.id === truckId);
  const trips = options.trips.filter((t) => t.truckId === truckId);
  const amountMinor = parseMoney(amount, currency);
  const litersNum = Number(liters.replace(/,/g, ""));
  const perLiter = amountMinor !== null && litersNum > 0 ? pricePerLiter(Number(amountMinor), litersNum) : null;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
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
        <Field label="الرحلة" htmlFor="trip_id" hint={truckId ? undefined : "اختر الشاحنة أولاً"}>
          <Select id="trip_id" name="trip_id" defaultValue={initial.trip_id ?? ""} key={truckId}>
            <option value="">بدون رحلة</option>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="المحطة" htmlFor="station_id">
          <Select id="station_id" name="station_id" defaultValue={initial.station_id ?? ""}>
            <option value="">—</option>
            {options.stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="التاريخ" htmlFor="filled_on">
            <Input id="filled_on" name="filled_on" type="date" dir="ltr" max={today} defaultValue={initial.filled_on ?? today} required />
          </Field>
          <Field label="الوقت" htmlFor="filled_time">
            <Input id="filled_time" name="filled_time" type="time" dir="ltr" defaultValue={initial.filled_time ?? time} required />
          </Field>
        </div>
        <Field
          label={<>قراءة العداد <span className="text-danger">*</span></>}
          htmlFor="odometer"
          hint={truck?.odometer ? `آخر قراءة مسجلة: ${truck.odometer.toLocaleString("en-US")} كم` : undefined}
        >
          <Input id="odometer" name="odometer" inputMode="numeric" dir="ltr" defaultValue={initial.odometer ?? ""} required />
        </Field>
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label={<>اللترات <span className="text-danger">*</span></>} htmlFor="liters">
            <Input id="liters" name="liters" inputMode="decimal" dir="ltr" value={liters} onChange={(e) => setLiters(e.target.value)} required />
          </Field>
          <label className="flex items-center gap-2 pb-2.5 text-sm font-medium">
            <input type="checkbox" name="is_full_tank" defaultChecked={initial.is_full_tank ?? true} className="size-4" />
            تعبئة كاملة
          </label>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label={<>المبلغ <span className="text-danger">*</span></>} htmlFor="amount" hint={perLiter !== null ? `سعر اللتر ${formatMoney(perLiter, currency)}` : undefined}>
            <Input id="amount" name="amount" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} required />
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
        <Field label="ملاحظة" htmlFor="notes">
          <Input id="notes" name="notes" defaultValue={initial.notes ?? ""} />
        </Field>
        <div className="sm:col-span-2">
          <ReceiptInput hasExisting={initial.hasReceipt} label="صورة الإيصال (اختياري)" />
        </div>
      </fieldset>
      {note ? <p className="text-sm text-muted">{note}</p> : null}
      <FormError message={error} />
      <div>
        <Button type="submit" disabled={busy}>
          {uploading ? "جارٍ رفع الصورة…" : pending ? "جارٍ الحفظ…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
