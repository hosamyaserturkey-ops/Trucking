"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { ReceiptFormState } from "@/app/(app)/receipts/actions";
import { CHEQUE_STATUS, RECEIPT_METHOD } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";

type Option = { id: string; label: string };
type Action = (prev: ReceiptFormState, formData: FormData) => Promise<ReceiptFormState>;

/** A payment from a customer. Cheques ask for their number, bank and due date. */
export function ReceiptForm({ action, clients, today, clientId }: { action: Action; clients: Option[]; today: string; clientId?: string }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [method, setMethod] = useState("cash");
  // A new key after each success clears the inputs.
  const [round, setRound] = useState(0);
  const [lastDone, setLastDone] = useState<ReceiptFormState | null>(null);
  if (state.done && state !== lastDone) {
    setLastDone(state);
    setRound((r) => r + 1);
    setMethod("cash");
  }

  return (
    <form key={round} action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="الزبون" htmlFor="rc_client">
          <Select id="rc_client" name="client_id" required defaultValue={clientId ?? ""}>
            <option value="">اختر الزبون</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="التاريخ" htmlFor="rc_date">
          <Input id="rc_date" name="received_on" type="date" dir="ltr" max={today} defaultValue={today} />
        </Field>
        <Field label="المبلغ (دينار)" htmlFor="rc_amount">
          <Input id="rc_amount" name="amount" inputMode="decimal" dir="ltr" required />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">طريقة القبض</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(RECEIPT_METHOD).map(([value, label]) => (
            <label
              key={value}
              className="flex cursor-pointer items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-medium has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary"
            >
              <input type="radio" name="method" value={value} checked={method === value} onChange={() => setMethod(value)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {method === "bank" ? (
        <Field label="رقم الحوالة / الإشعار" htmlFor="rc_ref">
          <Input id="rc_ref" name="reference_no" dir="ltr" />
        </Field>
      ) : null}
      {method === "cheque" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="رقم الشيك" htmlFor="rc_cheque_no">
            <Input id="rc_cheque_no" name="cheque_no" dir="ltr" required />
          </Field>
          <Field label="البنك" htmlFor="rc_cheque_bank">
            <Input id="rc_cheque_bank" name="cheque_bank" />
          </Field>
          <Field label="تاريخ الاستحقاق" htmlFor="rc_cheque_due">
            <Input id="rc_cheque_due" name="cheque_due_date" type="date" dir="ltr" required />
          </Field>
        </div>
      ) : null}
      <Field label="وذلك عن / ملاحظات" htmlFor="rc_notes">
        <Input id="rc_notes" name="notes" />
      </Field>
      <FormError message={state.error} />
      {state.done && state.receiptId ? (
        <p role="status" className="text-sm text-success">
          تم حفظ سند القبض رقم <span className="num">{state.receiptNo}</span>.{" "}
          <Link href={`/print/receipts/${state.receiptId}`} target="_blank" className="underline">
            طباعة السند
          </Link>
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : "حفظ سند القبض"}
        </Button>
      </div>
    </form>
  );
}

/** Move a cheque along: deposited, cleared or bounced, with the day it happened. */
export function ChequeStatusForm({ action, status, today }: { action: Action; status: string; today: string }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const next = status === "in_hand" ? "deposited" : "cleared";
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1.5">
      <select name="cheque_status" defaultValue={next} aria-label="حالة الشيك" className="rounded-md border border-border bg-surface px-2 py-1 text-xs">
        {Object.entries(CHEQUE_STATUS).map(([value, s]) => (
          <option key={value} value={value}>
            {s.label}
          </option>
        ))}
      </select>
      <input type="date" name="status_on" defaultValue={today} max={today} aria-label="التاريخ" className="rounded-md border border-border bg-surface px-2 py-1 text-xs" dir="ltr" />
      <button type="submit" disabled={pending} className="rounded-md border border-border px-2 py-1 text-xs font-medium text-primary hover:bg-surface-2">
        {pending ? "…" : "حفظ"}
      </button>
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

/** Delete a receipt entered by mistake (its entries are reversed). */
export function DeleteReceiptButton({ action }: { action: (prev: ReceiptFormState) => Promise<ReceiptFormState> }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm("حذف سند القبض؟ تُعكس قيوده.")) e.preventDefault();
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
