"use client";

import { useActionState, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { CustomsFormState } from "@/app/(app)/customs/actions";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";
import { ReceiptInput, useReceiptAction } from "@/components/receipt-input";

type Option = { id: string; label: string };
type Action = (prev: CustomsFormState, formData: FormData) => Promise<CustomsFormState>;

/**
 * Opens the customs inquiry system in a new tab, where the user signs in with
 * the broker's account in their own browser. The declaration number is copied
 * first, ready to paste into the system's search.
 */
export function CustomsPortalButton({ url, declarationNo, compact = false }: { url: string; declarationNo?: string | null; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={compact ? "inline-flex items-center gap-1 text-xs text-primary hover:underline" : buttonClass("primary")}
        onClick={() => {
          if (!declarationNo) return;
          navigator.clipboard
            ?.writeText(declarationNo)
            .then(() => setCopied(true))
            .catch(() => setCopied(false));
        }}
      >
        <ExternalLink className={compact ? "size-3.5" : "size-4"} aria-hidden />
        {compact ? "فتح في نظام الجمارك" : "فتح نظام الاستفسار الجمركي"}
      </a>
      {copied ? (
        <span role="status" className="text-xs text-success">
          نُسخ رقم البيان؛ الصقه في البحث
        </span>
      ) : null}
    </span>
  );
}

/** File a declaration: number, date, the load it belongs to, and its PDF or photo. */
export function CustomsDocumentForm({
  action,
  trips,
  today,
  initial = {},
}: {
  action: Action;
  trips: Option[];
  today: string;
  initial?: { declaration_no?: string; trip_id?: string };
}) {
  const { busy, uploading, pending, error, onSubmit } = useReceiptAction(action, "customs_document");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-3">
        <Field label="رقم البيان الجمركي" htmlFor="declaration_no">
          <Input id="declaration_no" name="declaration_no" dir="ltr" defaultValue={initial.declaration_no ?? ""} required />
        </Field>
        <Field label="تاريخ البيان" htmlFor="declaration_date">
          <Input id="declaration_date" name="declaration_date" type="date" dir="ltr" max={today} />
        </Field>
        <Field label="النقلة (اختياري)" htmlFor="trip_id">
          <Select id="trip_id" name="trip_id" defaultValue={initial.trip_id ?? ""}>
            <option value="">بدون نقلة</option>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-3">
          <Field label="ملاحظات" htmlFor="notes">
            <Input id="notes" name="notes" />
          </Field>
        </div>
        <div className="sm:col-span-3">
          <ReceiptInput label="ملف البيان (PDF أو صورة)" document />
        </div>
      </fieldset>
      <FormError message={error} />
      <div>
        <Button type="submit" disabled={busy}>
          {uploading ? "جارٍ رفع الملف…" : pending ? "جارٍ الحفظ…" : "حفظ البيان"}
        </Button>
      </div>
    </form>
  );
}

/** Delete a declaration filed by mistake. */
export function DeleteCustomsButton({ action }: { action: (prev: CustomsFormState) => Promise<CustomsFormState> }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm("حذف البيان وملفه؟")) e.preventDefault();
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
