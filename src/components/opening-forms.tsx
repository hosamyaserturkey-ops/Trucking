"use client";

import { useActionState, useState } from "react";
import type { OpeningFormState } from "@/app/(app)/opening/actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";

type Option = { id: string; label: string };
type Action = (prev: OpeningFormState, formData: FormData) => Promise<OpeningFormState>;

/** Clears the inputs after each save: a new key remounts the form. */
function useResetOnDone(state: OpeningFormState) {
  const [round, setRound] = useState(0);
  const [lastDone, setLastDone] = useState<OpeningFormState | null>(null);
  if (state.done && state !== lastDone) {
    setLastDone(state);
    setRound((r) => r + 1);
  }
  return round;
}

/** The first day in the system. */
export function OpeningDateForm({ action, value, canClear }: { action: Action; value: string | null; canClear: boolean }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <Field label="تاريخ بدء العمل على النظام" htmlFor="opening_date">
        <Input id="opening_date" name="opening_date" type="date" dir="ltr" defaultValue={value ?? ""} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "جارٍ الحفظ…" : value ? "تغيير التاريخ" : "حفظ التاريخ"}
      </Button>
      {value && canClear ? (
        <button type="submit" name="clear" value="1" disabled={pending} className="text-sm text-danger hover:underline">
          إزالة التاريخ
        </button>
      ) : null}
      <FormError message={state.error} />
      {state.done ? (
        <p role="status" className="text-sm text-success">
          تم حفظ التاريخ.
        </p>
      ) : null}
    </form>
  );
}

/** A balance for an account, customer or supplier, on the side the user picks. */
export function OpeningBalanceForm({
  action,
  options,
  targetLabel,
  sides,
  defaultSide,
  idPrefix,
}: {
  action: Action;
  options: Option[];
  targetLabel: string;
  sides: { debit: string; credit: string };
  defaultSide: "debit" | "credit";
  idPrefix: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const round = useResetOnDone(state);
  return (
    <form key={round} action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Field label={targetLabel} htmlFor={`${idPrefix}_target`}>
            <Select id={`${idPrefix}_target`} name="target_id" required defaultValue="">
              <option value="">اختر</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="الرصيد (دينار)" htmlFor={`${idPrefix}_amount`}>
          <Input id={`${idPrefix}_amount`} name="amount" inputMode="decimal" dir="ltr" required />
        </Field>
        <Field label="الجهة" htmlFor={`${idPrefix}_side`}>
          <Select id={`${idPrefix}_side`} name="side" defaultValue={defaultSide}>
            <option value="debit">{sides.debit}</option>
            <option value="credit">{sides.credit}</option>
          </Select>
        </Field>
      </div>
      <Field label="ملاحظات" htmlFor={`${idPrefix}_notes`}>
        <Input id={`${idPrefix}_notes`} name="notes" />
      </Field>
      <FormError message={state.error} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : "حفظ الرصيد"}
        </Button>
      </div>
    </form>
  );
}

/** An advance a driver still holds on the opening date. */
export function OpeningAdvanceForm({ action, drivers }: { action: Action; drivers: Option[] }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const round = useResetOnDone(state);
  return (
    <form key={round} action={formAction} className="flex flex-wrap items-end gap-3">
      <Field label="السائق" htmlFor="oa_driver">
        <Select id="oa_driver" name="driver_id" required defaultValue="">
          <option value="">اختر السائق</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="المبلغ معه (دينار)" htmlFor="oa_amount">
        <Input id="oa_amount" name="amount" inputMode="decimal" dir="ltr" required />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "جارٍ الحفظ…" : "إضافة العهدة"}
      </Button>
      <FormError message={state.error} />
    </form>
  );
}

/** A cheque on the opening date: a customer's in hand, or ours not yet paid. */
export function OpeningChequeForm({ action, parties, partyLabel, idPrefix }: { action: Action; parties: Option[]; partyLabel: string; idPrefix: string }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const round = useResetOnDone(state);
  return (
    <form key={round} action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-5">
        <Field label={partyLabel} htmlFor={`${idPrefix}_party`}>
          <Select id={`${idPrefix}_party`} name="party_id" required defaultValue="">
            <option value="">اختر</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="رقم الشيك" htmlFor={`${idPrefix}_no`}>
          <Input id={`${idPrefix}_no`} name="cheque_no" dir="ltr" required />
        </Field>
        <Field label="البنك" htmlFor={`${idPrefix}_bank`}>
          <Input id={`${idPrefix}_bank`} name="cheque_bank" />
        </Field>
        <Field label="تاريخ الاستحقاق" htmlFor={`${idPrefix}_due`}>
          <Input id={`${idPrefix}_due`} name="cheque_due_date" type="date" dir="ltr" required />
        </Field>
        <Field label="المبلغ (دينار)" htmlFor={`${idPrefix}_amount`}>
          <Input id={`${idPrefix}_amount`} name="amount" inputMode="decimal" dir="ltr" required />
        </Field>
      </div>
      <FormError message={state.error} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : "إضافة الشيك"}
        </Button>
      </div>
    </form>
  );
}

/** Remove one opening line (its entry is re-posted). */
export function DeleteOpeningButton({ action, confirmText = "حذف هذا الرصيد الافتتاحي؟" }: { action: (prev: OpeningFormState) => Promise<OpeningFormState>; confirmText?: string }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(confirmText)) e.preventDefault();
      }}
      className="inline"
    >
      <button type="submit" disabled={pending} className="text-xs text-danger hover:underline">
        حذف
      </button>
      {state.error ? <span className="ms-2 text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}
