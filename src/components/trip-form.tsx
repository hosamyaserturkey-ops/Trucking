"use client";

import { useActionState, useState } from "react";
import type { TripOptions } from "@/lib/trip-options";
import type { TripFormState } from "@/app/(app)/trips/actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/form";

export type TripInitial = {
  truck_id?: string;
  driver_id?: string | null;
  client_id?: string | null;
  from_location_id?: string;
  to_location_id?: string;
  start_date: string;
  start_odometer?: number | null;
  cargo_description?: string | null;
  cargo_weight_tons?: number | string | null;
  is_empty_return?: boolean;
  currency?: string;
  freight?: string;
  fx_rate?: string | number;
  notes?: string | null;
};

type Props = {
  options: TripOptions;
  initial: TripInitial;
  action: (prev: TripFormState, formData: FormData) => Promise<TripFormState>;
  mode: "new" | "edit";
};

export function TripForm({ options, initial, action, mode }: Props) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [truckId, setTruckId] = useState(initial.truck_id ?? "");
  const [driverId, setDriverId] = useState(initial.driver_id ?? "");
  const [startNow, setStartNow] = useState(false);
  const [odometer, setOdometer] = useState(initial.start_odometer?.toString() ?? "");
  const [emptyReturn, setEmptyReturn] = useState(!!initial.is_empty_return);
  const [currency, setCurrency] = useState(initial.currency ?? "JOD");
  const [fxRate, setFxRate] = useState(String(initial.fx_rate ?? options.rates[initial.currency ?? "JOD"] ?? "1"));

  const truck = options.trucks.find((t) => t.id === truckId);

  const onTruck = (id: string) => {
    setTruckId(id);
    const t = options.trucks.find((x) => x.id === id);
    if (t?.driverId) setDriverId(t.driverId);
    if (mode === "new" && t?.odometer) setOdometer(String(t.odometer));
  };

  const onCurrency = (code: string) => {
    setCurrency(code);
    setFxRate(options.rates[code] ?? "1");
  };

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
        <Field label={<>الشاحنة <span className="text-danger">*</span></>} htmlFor="truck_id">
          <Select id="truck_id" name="truck_id" value={truckId} onChange={(e) => onTruck(e.target.value)} required>
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

        <Field label={<>من <span className="text-danger">*</span></>} htmlFor="from_location_id">
          <Select id="from_location_id" name="from_location_id" defaultValue={initial.from_location_id ?? ""} required>
            <option value="">اختر</option>
            {options.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={<>إلى <span className="text-danger">*</span></>} htmlFor="to_location_id">
          <Select id="to_location_id" name="to_location_id" defaultValue={initial.to_location_id ?? ""} required>
            <option value="">اختر</option>
            {options.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={<>تاريخ البدء <span className="text-danger">*</span></>} htmlFor="start_date">
          <Input id="start_date" name="start_date" type="date" dir="ltr" defaultValue={initial.start_date} required />
        </Field>
        {mode === "new" ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">الحالة</legend>
            <div className="flex gap-4 py-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="status" value="planned" checked={!startNow} onChange={() => setStartNow(false)} />
                مخططة
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="status" value="in_progress" checked={startNow} onChange={() => setStartNow(true)} />
                بدأت الآن
              </label>
            </div>
          </fieldset>
        ) : null}
        {mode === "edit" || startNow ? (
          <Field
            label="قراءة العداد عند البدء"
            htmlFor="start_odometer"
            hint={truck?.odometer ? `آخر قراءة مسجلة: ${truck.odometer.toLocaleString("en-US")} كم` : undefined}
          >
            <Input
              id="start_odometer"
              name="start_odometer"
              inputMode="numeric"
              dir="ltr"
              value={odometer}
              onChange={(e) => setOdometer(e.target.value)}
              required={startNow}
            />
          </Field>
        ) : null}

        <label className="flex items-center gap-2 self-end py-2 text-sm font-medium sm:col-span-2">
          <input
            type="checkbox"
            name="is_empty_return"
            checked={emptyReturn}
            onChange={(e) => setEmptyReturn(e.target.checked)}
            className="size-4 accent-[var(--primary)]"
          />
          عودة فارغة (بدون حمولة ولا أجرة)
        </label>

        {emptyReturn ? null : (
          <>
            <Field label={<>العميل <span className="text-danger">*</span></>} htmlFor="client_id">
              <Select id="client_id" name="client_id" defaultValue={initial.client_id ?? ""} required>
                <option value="">اختر العميل</option>
                {options.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="البضاعة" htmlFor="cargo_description">
              <Input id="cargo_description" name="cargo_description" defaultValue={initial.cargo_description ?? ""} />
            </Field>
            <Field label="الوزن (طن)" htmlFor="cargo_weight_tons">
              <Input
                id="cargo_weight_tons"
                name="cargo_weight_tons"
                inputMode="decimal"
                dir="ltr"
                defaultValue={initial.cargo_weight_tons?.toString() ?? ""}
              />
            </Field>
            <Field label="العملة" htmlFor="currency">
              <Select id="currency" name="currency" value={currency} onChange={(e) => onCurrency(e.target.value)}>
                <option value="JOD">دينار أردني</option>
                <option value="USD">دولار أمريكي</option>
              </Select>
            </Field>
            <Field label={<>أجرة النقل <span className="text-danger">*</span></>} htmlFor="freight">
              <Input id="freight" name="freight" inputMode="decimal" dir="ltr" defaultValue={initial.freight ?? ""} required />
            </Field>
            {currency !== "JOD" ? (
              <Field label="سعر الصرف إلى الدينار" htmlFor="fx_rate" hint="يُحفظ مع الرحلة ولا يتغير لاحقاً">
                <Input id="fx_rate" name="fx_rate" inputMode="decimal" dir="ltr" value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
              </Field>
            ) : null}
          </>
        )}

        <div className="sm:col-span-2">
          <Field label="ملاحظات" htmlFor="notes">
            <Textarea id="notes" name="notes" rows={2} defaultValue={initial.notes ?? ""} />
          </Field>
        </div>
      </fieldset>
      <FormError message={state.error} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : mode === "new" ? "حفظ الرحلة" : "حفظ التعديلات"}
        </Button>
      </div>
    </form>
  );
}
