"use client";

import { useState } from "react";
import type { DriverFormState } from "@/app/(app)/my/actions";
import { formatMoney, parseMoney } from "@/lib/money";
import { pricePerLiter } from "@/lib/fuel";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";
import { ReceiptInput, useReceiptAction } from "@/components/receipt-input";

type Option = { id: string; label: string };

type Props = {
  recordId?: string;
  trips: Option[];
  stations: Option[];
  truckLabel: string | null;
  lastOdometer: number | null;
  today: string;
  time: string;
  initial?: {
    trip_id?: string | null;
    station_id?: string | null;
    filled_on?: string;
    filled_time?: string;
    odometer?: string;
    liters?: string;
    is_full_tank?: boolean;
    currency?: string;
    amount?: string;
    notes?: string | null;
    hasReceipt?: boolean;
  };
  action: (prev: DriverFormState, formData: FormData) => Promise<DriverFormState>;
  submitLabel: string;
};

/** Phone form for a fill-up paid from the advance. The receipt photo is required. */
export function DriverFuelForm({ recordId, trips, stations, truckLabel, lastOdometer, today, time, initial = {}, action, submitLabel }: Props) {
  const { busy, uploading, pending, error, onSubmit } = useReceiptAction(action, "fuel_receipt", recordId);
  const [amount, setAmount] = useState(initial.amount ?? "");
  const [liters, setLiters] = useState(initial.liters ?? "");
  const [currency, setCurrency] = useState(initial.currency ?? "JOD");

  const amountMinor = parseMoney(amount, currency);
  const litersNum = Number(liters.replace(/,/g, ""));
  const perLiter = amountMinor !== null && litersNum > 0 ? pricePerLiter(Number(amountMinor), litersNum) : null;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <fieldset disabled={busy} className="flex flex-col gap-4">
        <Field label="الرحلة" htmlFor="trip_id">
          <Select id="trip_id" name="trip_id" defaultValue={initial.trip_id ?? trips[0]?.id ?? ""}>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
            <option value="">{truckLabel ? `بدون رحلة (الشاحنة ${truckLabel})` : "بدون رحلة"}</option>
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
          label="قراءة العداد (كم)"
          htmlFor="odometer"
          hint={lastOdometer ? `آخر قراءة مسجلة للشاحنة: ${lastOdometer.toLocaleString("en-US")} كم` : undefined}
        >
          <Input id="odometer" name="odometer" inputMode="numeric" dir="ltr" defaultValue={initial.odometer ?? ""} className="text-lg" required />
        </Field>
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label="عدد اللترات" htmlFor="liters">
            <Input
              id="liters"
              name="liters"
              inputMode="decimal"
              dir="ltr"
              value={liters}
              onChange={(e) => setLiters(e.target.value)}
              className="text-lg"
              required
            />
          </Field>
          <label className="flex items-center gap-2 pb-2.5 text-sm font-medium">
            <input type="checkbox" name="is_full_tank" defaultChecked={initial.is_full_tank ?? true} className="size-4" />
            تعبئة كاملة
          </label>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="المبلغ المدفوع" htmlFor="amount">
            <Input
              id="amount"
              name="amount"
              inputMode="decimal"
              dir="ltr"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-lg"
              required
            />
          </Field>
          <Field label="العملة" htmlFor="currency">
            <Select id="currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="JOD">دينار</option>
              <option value="USD">دولار</option>
            </Select>
          </Field>
        </div>
        <p className="-mt-2 text-sm text-muted" aria-live="polite">
          سعر اللتر: <span className="num font-medium text-text">{perLiter !== null ? formatMoney(perLiter, currency) : "—"}</span>
        </p>
        <Field label="المحطة (اختياري)" htmlFor="station_id">
          <Select id="station_id" name="station_id" defaultValue={initial.station_id ?? ""}>
            <option value="">—</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ملاحظة" htmlFor="notes">
          <Input id="notes" name="notes" defaultValue={initial.notes ?? ""} />
        </Field>
        <ReceiptInput hasExisting={initial.hasReceipt} label={initial.hasReceipt ? "صورة الإيصال" : "صورة الإيصال (مطلوبة)"} />
      </fieldset>
      <p className="text-xs text-muted">تُخصم من عهدتك بعد موافقة المحاسب.</p>
      <FormError message={error} />
      <Button type="submit" disabled={busy} className="w-full py-3 text-base">
        {uploading ? "جارٍ رفع الصورة…" : pending ? "جارٍ الحفظ…" : submitLabel}
      </Button>
    </form>
  );
}
