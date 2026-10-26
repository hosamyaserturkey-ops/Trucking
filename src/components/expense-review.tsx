"use client";

import { useActionState, useState } from "react";
import { Check, X } from "lucide-react";
import type { ReviewState } from "@/app/(app)/approvals/actions";
import { Button } from "@/components/ui/button";
import { FormError, Input, Select } from "@/components/ui/form";

type Action = (prev: ReviewState, formData: FormData) => Promise<ReviewState>;

/** Approve (optionally correcting category, amount, rate) or reject with a reason. */
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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <label className="col-span-2 flex flex-col gap-1 text-xs text-muted sm:col-span-1">
            النوع
            <Select name="category_id" defaultValue={initial.category_id} disabled={busy}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            المبلغ ({initial.currency === "USD" ? "$" : "د.أ"})
            <Input name="amount" inputMode="decimal" dir="ltr" defaultValue={initial.amount} disabled={busy} />
          </label>
          {initial.currency !== "JOD" ? (
            <label className="flex flex-col gap-1 text-xs text-muted">
              سعر الصرف
              <Input name="fx_rate" inputMode="decimal" dir="ltr" defaultValue={initial.fx_rate} disabled={busy} />
            </label>
          ) : null}
        </div>
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
