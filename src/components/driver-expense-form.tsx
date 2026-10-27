"use client";

import type { DriverFormState } from "@/app/(app)/my/actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";
import { ReceiptInput, useReceiptAction } from "@/components/receipt-input";

type Option = { id: string; label: string };

type Props = {
  /** The expense being edited, so the server can check it may still get a new photo. */
  recordId?: string;
  trips: Option[];
  categories: Option[];
  today: string;
  initial?: {
    trip_id?: string | null;
    category_id?: string;
    expense_date?: string;
    currency?: string;
    amount?: string;
    payment_method?: string;
    description?: string | null;
    hasReceipt?: boolean;
  };
  action: (prev: DriverFormState, formData: FormData) => Promise<DriverFormState>;
  submitLabel: string;
};

/** Phone-first expense form. The photo is shrunk and uploaded before the form is saved. */
export function DriverExpenseForm({ recordId, trips, categories, today, initial = {}, action, submitLabel }: Props) {
  const { busy, uploading, pending, error, onSubmit } = useReceiptAction(action, "expense_receipt", recordId);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <fieldset disabled={busy} className="flex flex-col gap-4">
        <Field label="الرحلة" htmlFor="trip_id">
          <Select id="trip_id" name="trip_id" defaultValue={initial.trip_id ?? trips[0]?.id ?? ""} required>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="نوع المصروف" htmlFor="category_id">
          <Select id="category_id" name="category_id" defaultValue={initial.category_id ?? ""} required>
            <option value="">اختر</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="المبلغ" htmlFor="amount">
            <Input
              id="amount"
              name="amount"
              inputMode="decimal"
              dir="ltr"
              defaultValue={initial.amount ?? ""}
              className="text-lg"
              required
            />
          </Field>
          <Field label="العملة" htmlFor="currency">
            <Select id="currency" name="currency" defaultValue={initial.currency ?? "JOD"}>
              <option value="JOD">دينار</option>
              <option value="USD">دولار</option>
            </Select>
          </Field>
        </div>
        <Field label="التاريخ" htmlFor="expense_date">
          <Input id="expense_date" name="expense_date" type="date" dir="ltr" max={today} defaultValue={initial.expense_date ?? today} />
        </Field>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">من دفع؟</legend>
          <div className="flex flex-wrap gap-4 py-1 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="payment_method" value="driver_advance" defaultChecked={initial.payment_method !== "credit"} />
              دفعتها أنا (من العهدة)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="payment_method" value="credit" defaultChecked={initial.payment_method === "credit"} />
              آجل على حساب الشركة
            </label>
          </div>
        </fieldset>
        <Field label="ملاحظة" htmlFor="description">
          <Input id="description" name="description" defaultValue={initial.description ?? ""} placeholder="مثال: أجور تنزيل في المستودع" />
        </Field>

        <ReceiptInput hasExisting={initial.hasReceipt} />
      </fieldset>
      <FormError message={error} />
      <Button type="submit" disabled={busy} className="w-full py-3 text-base">
        {uploading ? "جارٍ رفع الصورة…" : pending ? "جارٍ الحفظ…" : submitLabel}
      </Button>
    </form>
  );
}
