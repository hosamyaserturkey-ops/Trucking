"use client";

import { useActionState, useState } from "react";
import type { TripOptions } from "@/lib/trip-options";
import type { LoadFormState } from "@/app/(app)/loading/actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";

export type LoadInitial = {
  load_date: string;
  truck_id?: string;
  driver_id?: string | null;
  client_id?: string;
  from_location_id?: string;
  to_location_id?: string;
  cargo_description?: string | null;
  cargo_weight_tons?: number | string | null;
  currency?: string;
  freight?: string;
  fx_rate?: string | number;
  client_doc_no?: string | null;
  notes?: string | null;
};

type Props = {
  options: TripOptions;
  initial: LoadInitial;
  today: string;
  action: (prev: LoadFormState, formData: FormData) => Promise<LoadFormState>;
  submitLabel: string;
};

/** One line of the daily loading sheet: who carried what, for whom, from where to where, for how much. */
export function LoadForm({ options, initial, today, action, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [truckId, setTruckId] = useState(initial.truck_id ?? "");
  const [driverId, setDriverId] = useState(initial.driver_id ?? "");
  const [currency, setCurrency] = useState(initial.currency ?? "JOD");
  const [fxRate, setFxRate] = useState(String(initial.fx_rate ?? options.rates[initial.currency ?? "JOD"] ?? "1"));

  const onTruck = (id: string) => {
    setTruckId(id);
    const t = options.trucks.find((x) => x.id === id);
    if (t?.driverId) setDriverId(t.driverId);
  };

  const onCurrency = (code: string) => {
    setCurrency(code);
    setFxRate(options.rates[code] ?? "1");
  };

  const required = <span className="text-danger">*</span>;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={<>التاريخ {required}</>} htmlFor="load_date">
          <Input id="load_date" name="load_date" type="date" dir="ltr" max={today} defaultValue={initial.load_date} required />
        </Field>
        <Field label={<>الشاحنة {required}</>} htmlFor="truck_id">
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
        <Field label={<>الزبون {required}</>} htmlFor="client_id">
          <Select id="client_id" name="client_id" defaultValue={initial.client_id ?? ""} required>
            <option value="">اختر الزبون</option>
            {options.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={<>من {required}</>} htmlFor="from_location_id">
          <Select id="from_location_id" name="from_location_id" defaultValue={initial.from_location_id ?? ""} required>
            <option value="">مكان التحميل</option>
            {options.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={<>إلى {required}</>} htmlFor="to_location_id">
          <Select id="to_location_id" name="to_location_id" defaultValue={initial.to_location_id ?? ""} required>
            <option value="">مكان التنزيل</option>
            {options.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="نوع الحمولة" htmlFor="cargo_description">
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

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label={<>الأجرة {required}</>} htmlFor="freight">
            <Input id="freight" name="freight" inputMode="decimal" dir="ltr" defaultValue={initial.freight ?? ""} required />
          </Field>
          <Field label="العملة" htmlFor="currency">
            <Select id="currency" name="currency" value={currency} onChange={(e) => onCurrency(e.target.value)}>
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
        <Field label="رقم مستند الزبون" htmlFor="client_doc_no" hint="بوليصة أو مستند نقل، إن وُجد">
          <Input id="client_doc_no" name="client_doc_no" dir="ltr" defaultValue={initial.client_doc_no ?? ""} />
        </Field>
        <Field label="ملاحظات" htmlFor="notes">
          <Input id="notes" name="notes" defaultValue={initial.notes ?? ""} />
        </Field>
      </fieldset>
      <FormError message={state.error} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
