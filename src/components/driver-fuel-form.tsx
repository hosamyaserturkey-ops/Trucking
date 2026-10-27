"use client";

import type { DriverFormState } from "@/app/(app)/my/actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";
import { ReceiptInput, useReceiptAction } from "@/components/receipt-input";
import { FuelQuantityFields, type FuelQuantityInitial, type LastFuelPrices } from "@/components/fuel-quantity-fields";

type Option = { id: string; label: string };

type Props = {
  recordId?: string;
  trips: Option[];
  stations: Option[];
  lastPrices: LastFuelPrices;
  truckLabel: string | null;
  lastOdometer: number | null;
  today: string;
  time: string;
  initial?: FuelQuantityInitial & {
    trip_id?: string | null;
    filled_on?: string;
    filled_time?: string;
    odometer?: string;
    is_full_tank?: boolean;
    notes?: string | null;
    hasReceipt?: boolean;
  };
  action: (prev: DriverFormState, formData: FormData) => Promise<DriverFormState>;
  submitLabel: string;
};

/** Phone form for a fill-up paid from the advance. The receipt photo is required. */
export function DriverFuelForm({ recordId, trips, stations, lastPrices, truckLabel, lastOdometer, today, time, initial = {}, action, submitLabel }: Props) {
  const { busy, uploading, pending, error, onSubmit } = useReceiptAction(action, "fuel_receipt", recordId);

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
        <FuelQuantityFields stations={stations} lastPrices={lastPrices} initial={initial} large />
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="is_full_tank" defaultChecked={initial.is_full_tank ?? true} className="size-4" />
          تعبئة كاملة (فل)
        </label>
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
