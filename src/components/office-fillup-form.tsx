"use client";

import { useState } from "react";
import type { FillupFormState } from "@/app/(app)/diesel/actions";
import type { OfficeOptions } from "@/lib/office-options";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";
import { ReceiptInput, useReceiptAction } from "@/components/receipt-input";
import { FuelQuantityFields, type FuelQuantityInitial, type LastFuelPrices } from "@/components/fuel-quantity-fields";

const PAYMENTS: [string, string][] = [
  ["cash", "نقداً"],
  ["card", "بطاقة"],
  ["credit", "آجل على حساب المحطة"],
  ["driver_advance", "دفعها السائق من العهدة"],
];

export type FillupInitial = FuelQuantityInitial & {
  truck_id?: string;
  driver_id?: string | null;
  trip_id?: string | null;
  filled_on?: string;
  filled_time?: string;
  odometer?: string;
  is_full_tank?: boolean;
  fx_rate?: string;
  payment_method?: string;
  notes?: string | null;
  hasReceipt?: boolean;
};

/** Office form for a fill-up: any truck, driver and payment; the receipt is optional. */
export function OfficeFillupForm({
  recordId,
  options,
  lastPrices,
  today,
  time,
  initial = {},
  action,
  submitLabel,
  note,
}: {
  recordId?: string;
  options: Pick<OfficeOptions, "trucks" | "drivers" | "trips" | "stations" | "rates">;
  lastPrices: LastFuelPrices;
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

  const truck = options.trucks.find((t) => t.id === truckId);
  const trips = options.trips.filter((t) => t.truckId === truckId);

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
        <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-medium">
          <input type="checkbox" name="is_full_tank" defaultChecked={initial.is_full_tank ?? true} className="size-4" />
          تعبئة كاملة (فل)
        </label>
        <div className="flex flex-col gap-4 rounded-xl border border-border p-4 sm:col-span-2">
          <FuelQuantityFields
            stations={options.stations}
            lastPrices={lastPrices}
            initial={initial}
            onCurrencyChange={(c) => {
              setCurrency(c);
              setFxRate(options.rates[c] ?? "1");
            }}
          />
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
