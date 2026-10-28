"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { PaymentFormState } from "@/app/(app)/payments/actions";
import { ISSUED_CHEQUE_STATUS, SUPPLIER_PAYMENT_METHOD } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";

type SupplierOption = { id: string; label: string; owed: string | null };
type Action = (prev: PaymentFormState, formData: FormData) => Promise<PaymentFormState>;

/** A payment to a supplier. Cheques ask for their number, our bank and the due date. */
export function SupplierPaymentForm({
  action,
  suppliers,
  today,
  supplierId,
}: {
  action: Action;
  suppliers: SupplierOption[];
  today: string;
  supplierId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [method, setMethod] = useState("cash");
  const [supplier, setSupplier] = useState(supplierId ?? "");
  // A new key after each success clears the inputs.
  const [round, setRound] = useState(0);
  const [lastDone, setLastDone] = useState<PaymentFormState | null>(null);
  if (state.done && state !== lastDone) {
    setLastDone(state);
    setRound((r) => r + 1);
    setMethod("cash");
  }
  const owed = suppliers.find((s) => s.id === supplier)?.owed;

  return (
    <form key={round} action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="المورد" htmlFor="sp_supplier" hint={owed ? `المستحق له: ${owed}` : undefined}>
          <Select id="sp_supplier" name="supplier_id" required value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">اختر المورد</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="التاريخ" htmlFor="sp_date">
          <Input id="sp_date" name="paid_on" type="date" dir="ltr" max={today} defaultValue={today} />
        </Field>
        <Field label="المبلغ (دينار)" htmlFor="sp_amount">
          <Input id="sp_amount" name="amount" inputMode="decimal" dir="ltr" required />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">طريقة الدفع</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(SUPPLIER_PAYMENT_METHOD).map(([value, label]) => (
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
        <Field label="رقم الحوالة / الإشعار" htmlFor="sp_ref">
          <Input id="sp_ref" name="reference_no" dir="ltr" />
        </Field>
      ) : null}
      {method === "cheque" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="رقم الشيك" htmlFor="sp_cheque_no">
            <Input id="sp_cheque_no" name="cheque_no" dir="ltr" required />
          </Field>
          <Field label="البنك المسحوب عليه" htmlFor="sp_cheque_bank">
            <Input id="sp_cheque_bank" name="cheque_bank" />
          </Field>
          <Field label="تاريخ الاستحقاق" htmlFor="sp_cheque_due">
            <Input id="sp_cheque_due" name="cheque_due_date" type="date" dir="ltr" required />
          </Field>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="رقم سند الصرف" htmlFor="sp_voucher">
          <Input id="sp_voucher" name="voucher_no" dir="ltr" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="وذلك عن / ملاحظات" htmlFor="sp_notes">
            <Input id="sp_notes" name="notes" />
          </Field>
        </div>
      </div>
      <FormError message={state.error} />
      {state.done && state.paymentId ? (
        <p role="status" className="text-sm text-success">
          تم حفظ الدفعة رقم <span className="num">{state.paymentNo}</span>.{" "}
          <Link href={`/print/payments/${state.paymentId}`} target="_blank" className="underline">
            طباعة سند الصرف
          </Link>
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : "حفظ الدفعة"}
        </Button>
      </div>
    </form>
  );
}

/** Move an issued cheque along: paid by the bank or bounced, with the day it happened. */
export function IssuedChequeStatusForm({ action, status, today }: { action: Action; status: string; today: string }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1.5">
      <select
        name="cheque_status"
        defaultValue={status === "issued" ? "cleared" : status}
        aria-label="حالة الشيك"
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
      >
        {Object.entries(ISSUED_CHEQUE_STATUS).map(([value, s]) => (
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

/** Delete a payment entered by mistake (its entries are reversed). */
export function DeletePaymentButton({ action }: { action: (prev: PaymentFormState) => Promise<PaymentFormState> }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm("حذف دفعة المورد؟ تُعكس قيودها.")) e.preventDefault();
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
