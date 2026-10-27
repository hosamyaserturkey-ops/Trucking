"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import type { ReviewState } from "@/app/(app)/approvals/actions";
import { Button } from "@/components/ui/button";
import { FormError, Input, Select } from "@/components/ui/form";
import { FUEL_UNITS, isFuelUnit } from "@/lib/fuel";

type Action = (prev: ReviewState, formData: FormData) => Promise<ReviewState>;

/** Approve with the correction fields given, or reject with a reason the driver sees. */
function ReviewForm({ approve, reject, fields }: { approve: Action; reject: Action; fields: ReactNode }) {
  const [approveState, approveAction, approving] = useActionState(approve, { error: null });
  const [rejectState, rejectAction, rejecting] = useActionState(reject, { error: null });
  const [rejectOpen, setRejectOpen] = useState(false);
  const busy = approving || rejecting;

  if (approveState.done || rejectState.done) {
    return (
      <p role="status" className="text-sm font-medium text-muted">
        {approveState.done ? "تم الاعتماد" : "تم الرفض"}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <form action={approveAction} className="flex flex-col gap-2">
        <fieldset disabled={busy}>{fields}</fieldset>
        <FormError message={approveState.error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            <Check className="size-4" aria-hidden />
            {approving ? "…" : "اعتماد"}
          </Button>
          {!rejectOpen ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setRejectOpen(true)}>
              <X className="size-4" aria-hidden />
              رفض
            </Button>
          ) : null}
        </div>
      </form>
      {rejectOpen ? (
        <form action={rejectAction} className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            سبب الرفض (يظهر للسائق)
            <Input name="reason" required autoFocus disabled={busy} placeholder="مثال: الإيصال غير واضح" />
          </label>
          <FormError message={rejectState.error} />
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" disabled={busy} className="text-danger">
              {rejecting ? "…" : "تأكيد الرفض"}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setRejectOpen(false)}>
              إلغاء
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

const LABEL = "flex flex-col gap-1 text-xs text-muted";

function RateField({ currency, fxRate }: { currency: string; fxRate: string }) {
  if (currency === "JOD") return null;
  return (
    <label className={LABEL}>
      سعر الصرف
      <Input name="fx_rate" inputMode="decimal" dir="ltr" defaultValue={fxRate} />
    </label>
  );
}

/** Approve an expense (optionally correcting category, amount, rate) or reject it. */
export function ExpenseReview({
  approve,
  reject,
  categories,
  initial,
}: {
  approve: Action;
  reject: Action;
  categories: { id: string; label: string }[];
  initial: { category_id: string; amount: string; currency: string; fx_rate: string };
}) {
  return (
    <ReviewForm
      approve={approve}
      reject={reject}
      fields={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <label className={`col-span-2 sm:col-span-1 ${LABEL}`}>
            النوع
            <Select name="category_id" defaultValue={initial.category_id}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </label>
          <label className={LABEL}>
            المبلغ ({initial.currency === "USD" ? "$" : "د.أ"})
            <Input name="amount" inputMode="decimal" dir="ltr" defaultValue={initial.amount} />
          </label>
          <RateField currency={initial.currency} fxRate={initial.fx_rate} />
        </div>
      }
    />
  );
}

/** Approve a fill-up (optionally correcting the quantity, unit price, odometer, full tank, rate) or reject it. */
export function FuelReview({
  approve,
  reject,
  initial,
}: {
  approve: Action;
  reject: Action;
  initial: { qty_unit: string; quantity: string; unit_price: string; odometer: string; is_full_tank: boolean; currency: string; fx_rate: string };
}) {
  // Corrections stay in the unit the fill-up was bought in.
  const unit = isFuelUnit(initial.qty_unit) ? FUEL_UNITS[initial.qty_unit] : FUEL_UNITS.liter;
  return (
    <ReviewForm
      approve={approve}
      reject={reject}
      fields={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className={LABEL}>
            {unit.count}
            <Input name="quantity" inputMode="decimal" dir="ltr" defaultValue={initial.quantity} />
          </label>
          <label className={LABEL}>
            {unit.price} ({initial.currency === "USD" ? "$" : "د.أ"})
            <Input name="unit_price" inputMode="decimal" dir="ltr" defaultValue={initial.unit_price} />
          </label>
          <label className={LABEL}>
            العداد
            <Input name="odometer" inputMode="numeric" dir="ltr" defaultValue={initial.odometer} />
          </label>
          <RateField currency={initial.currency} fxRate={initial.fx_rate} />
          <label className="col-span-2 flex items-center gap-2 text-sm sm:col-span-4">
            <input type="checkbox" name="is_full_tank" defaultChecked={initial.is_full_tank} className="size-4" />
            تعبئة كاملة
          </label>
        </div>
      }
    />
  );
}
