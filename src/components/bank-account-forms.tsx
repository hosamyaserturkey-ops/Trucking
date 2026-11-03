"use client";

import { useActionState, useState } from "react";
import type { BankFormState } from "@/app/(app)/banks/actions";
import { BANK_MOVEMENT_TYPES, type BankMovementType } from "@/lib/bank";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";

type Option = { id: string; label: string };
type Action = (prev: BankFormState, formData: FormData) => Promise<BankFormState>;

/** Clears the inputs after each success: a new key remounts the form. */
function useRound(state: BankFormState) {
  const [round, setRound] = useState(0);
  const [lastDone, setLastDone] = useState<BankFormState | null>(null);
  if (state.done && state !== lastDone) {
    setLastDone(state);
    setRound((r) => r + 1);
  }
  return round;
}

/** A new bank account: its name (bank and kind) and number. */
export function NewBankAccountForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const round = useRound(state);
  return (
    <form key={round} action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="اسم الحساب" htmlFor="ba_name" hint="مثل: البنك العربي — جاري">
          <Input id="ba_name" name="name" required maxLength={100} />
        </Field>
        <Field label="رقم الحساب / IBAN" htmlFor="ba_no">
          <Input id="ba_no" name="account_no" dir="ltr" maxLength={60} />
        </Field>
      </div>
      <FormError message={state.error} />
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "جارٍ الحفظ…" : "إضافة الحساب البنكي"}
      </Button>
    </form>
  );
}

/** Rename a bank account or change its number. */
export function EditBankAccountForm({ action, name, accountNo }: { action: Action; name: string; accountNo: string }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-primary">تعديل الاسم والرقم</summary>
      <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2">
        <span className="w-56">
          <Input name="name" defaultValue={name} required maxLength={100} aria-label="اسم الحساب" />
        </span>
        <span className="w-48">
          <Input name="account_no" defaultValue={accountNo} dir="ltr" maxLength={60} aria-label="رقم الحساب" placeholder="رقم الحساب / IBAN" />
        </span>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "…" : "حفظ"}
        </Button>
        {state.error ? <span className="w-full text-xs text-danger">{state.error}</span> : null}
        {state.done && !state.error ? <span className="text-xs text-success">تم الحفظ</span> : null}
      </form>
    </details>
  );
}

/**
 * A movement on this bank account that no other screen makes. The kind fixes
 * the direction and, for most kinds, the other account.
 */
export function BankMovementForm({
  action,
  today,
  otherBanks,
  accounts,
  trucks,
}: {
  action: Action;
  today: string;
  otherBanks: Option[];
  accounts: Option[];
  trucks: Option[];
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const round = useRound(state);
  const [type, setType] = useState<BankMovementType>("cash_in");
  const t = BANK_MOVEMENT_TYPES[type];
  const counterOptions = t.kind === "transfer" ? otherBanks : accounts;
  return (
    <form key={round} action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="نوع الحركة" htmlFor="bm_type">
          <Select id="bm_type" name="type" value={type} onChange={(e) => setType(e.target.value as BankMovementType)}>
            {Object.entries(BANK_MOVEMENT_TYPES).map(([value, x]) => (
              <option key={value} value={value} disabled={x.kind === "transfer" && otherBanks.length === 0}>
                {x.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="التاريخ" htmlFor="bm_date">
          <Input id="bm_date" name="moved_on" type="date" dir="ltr" max={today} defaultValue={today} />
        </Field>
        <Field label={t.direction === "in" ? "المبلغ الداخل للبنك (د.أ)" : "المبلغ الخارج من البنك (د.أ)"} htmlFor="bm_amount">
          <Input id="bm_amount" name="amount" inputMode="decimal" dir="ltr" required />
        </Field>
        {t.counter === null ? (
          <Field label={t.kind === "transfer" ? (t.direction === "out" ? "إلى الحساب البنكي" : "من الحساب البنكي") : "الحساب المقابل"} htmlFor="bm_counter">
            <Select id="bm_counter" name="counter_account_id" required defaultValue="">
              <option value="" disabled>
                اختر…
              </option>
              {counterOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {t.kind === "charges" || t.kind === "other" ? (
          <Field label="على الشاحنة (اختياري)" htmlFor="bm_truck" hint="لمصروف أو إيراد يخص شاحنة">
            <Select id="bm_truck" name="truck_id" defaultValue="">
              <option value="">—</option>
              {trucks.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="رقم الإشعار / المرجع" htmlFor="bm_ref">
          <Input id="bm_ref" name="reference_no" dir="ltr" maxLength={60} />
        </Field>
        <Field label="البيان" htmlFor="bm_desc">
          <Input id="bm_desc" name="description" maxLength={300} />
        </Field>
      </div>
      <FormError message={state.error} />
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "جارٍ الحفظ…" : "تسجيل الحركة"}
      </Button>
    </form>
  );
}

/** Delete a movement entered by mistake (its entry is reversed). */
export function DeleteMovementButton({ action }: { action: (prev: BankFormState) => Promise<BankFormState> }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm("حذف الحركة البنكية؟ يُعكس قيدها.")) e.preventDefault();
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
