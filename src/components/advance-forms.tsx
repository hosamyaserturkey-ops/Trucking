"use client";

import { useActionState, useMemo, useState } from "react";
import type { AdvanceFormState } from "@/app/(app)/advances/actions";
import { settlementPreview, type LedgerInput } from "@/lib/advances";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";

type Option = { id: string; label: string };
type Action = (prev: AdvanceFormState, formData: FormData) => Promise<AdvanceFormState>;

/** Issue an advance. With `driverId` the driver is fixed and a trip can be linked. */
export function AdvanceForm({
  action,
  today,
  rates,
  drivers,
  driverId,
  trips = [],
}: {
  action: Action;
  today: string;
  rates: Record<string, string>;
  drivers?: Option[];
  driverId?: string;
  trips?: Option[];
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [currency, setCurrency] = useState("JOD");
  const [fxRate, setFxRate] = useState(rates.JOD ?? "1");
  // A new key after each success clears the inputs.
  const [round, setRound] = useState(0);
  const [lastDone, setLastDone] = useState<AdvanceFormState | null>(null);
  if (state.done && state !== lastDone) {
    setLastDone(state);
    setRound((r) => r + 1);
  }

  return (
    <form key={round} action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {driverId ? (
          <input type="hidden" name="driver_id" value={driverId} />
        ) : (
          <Field label="السائق" htmlFor="adv_driver">
            <Select id="adv_driver" name="driver_id" required defaultValue="">
              <option value="">اختر السائق</option>
              {(drivers ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {driverId && trips.length ? (
          <Field label="الرحلة (اختياري)" htmlFor="adv_trip">
            <Select id="adv_trip" name="trip_id" defaultValue="">
              <option value="">بدون رحلة</option>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="التاريخ" htmlFor="adv_date">
          <Input id="adv_date" name="issued_on" type="date" dir="ltr" max={today} defaultValue={today} />
        </Field>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="المبلغ" htmlFor="adv_amount">
            <Input id="adv_amount" name="amount" inputMode="decimal" dir="ltr" required />
          </Field>
          <Field label="العملة" htmlFor="adv_currency">
            <Select
              id="adv_currency"
              name="currency"
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value);
                setFxRate(rates[e.target.value] ?? "1");
              }}
            >
              <option value="JOD">دينار</option>
              <option value="USD">دولار</option>
            </Select>
          </Field>
        </div>
        {currency !== "JOD" ? (
          <Field label="سعر الصرف إلى الدينار" htmlFor="adv_rate">
            <Input id="adv_rate" name="fx_rate" inputMode="decimal" dir="ltr" value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
          </Field>
        ) : null}
        <Field label="طريقة الصرف" htmlFor="adv_method">
          <Select id="adv_method" name="method" defaultValue="cash">
            <option value="cash">نقداً</option>
            <option value="bank">تحويل بنكي</option>
          </Select>
        </Field>
        <Field label="ملاحظة" htmlFor="adv_notes">
          <Input id="adv_notes" name="notes" />
        </Field>
      </div>
      <FormError message={state.error} />
      {state.done ? (
        <p role="status" className="text-sm text-success">
          تم تسجيل العهدة.
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "جارٍ الحفظ…" : "تسجيل العهدة"}
      </Button>
    </form>
  );
}

/** Settle a driver: live preview of what the chosen date closes, then confirm. */
export function SettleForm({
  action,
  today,
  items,
  pendingCount,
}: {
  action: Action;
  today: string;
  items: LedgerInput[];
  pendingCount: number;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [onDate, setOnDate] = useState(today);
  const preview = useMemo(() => settlementPreview(items, onDate), [items, onDate]);
  const diff = preview.difference;
  const outcome =
    diff > 0
      ? `يُرجع السائق للشركة ${formatMoney(diff, "JOD")}`
      : diff < 0
        ? `تدفع الشركة للسائق ${formatMoney(-diff, "JOD")}`
        : "لا يوجد فرق نقدي";

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const warn = pendingCount > 0 ? `\nتنبيه: ${pendingCount} مصروف بانتظار الموافقة لن تدخل في هذه التسوية.` : "";
        if (!confirm(`تأكيد التسوية حتى ${onDate}؟\n${outcome}${warn}`)) e.preventDefault();
      }}
      className="flex flex-col gap-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="تسوية الحركات حتى تاريخ" htmlFor="settled_on">
          <Input id="settled_on" name="settled_on" type="date" dir="ltr" max={today} value={onDate} onChange={(e) => setOnDate(e.target.value)} />
        </Field>
        <Field label="ملاحظة" htmlFor="settle_notes">
          <Input id="settle_notes" name="notes" />
        </Field>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 rounded-lg bg-surface-2 p-3 text-sm">
        <dt className="text-muted">عدد الحركات</dt>
        <dd className="num font-medium">{preview.count}</dd>
        <dt className="text-muted">العهد</dt>
        <dd className="num font-medium">{formatMoney(preview.advances, "JOD")}</dd>
        <dt className="text-muted">المصاريف المعتمدة</dt>
        <dd className="num font-medium">{formatMoney(preview.expenses, "JOD")}</dd>
        <dt className="text-muted">النتيجة</dt>
        <dd className={`font-semibold ${diff > 0 ? "text-warning" : diff < 0 ? "text-success" : ""}`}>{outcome}</dd>
      </dl>
      <FormError message={state.error} />
      <Button type="submit" disabled={pending || preview.count === 0} className="w-fit">
        {pending ? "جارٍ التسوية…" : "تسوية"}
      </Button>
    </form>
  );
}
