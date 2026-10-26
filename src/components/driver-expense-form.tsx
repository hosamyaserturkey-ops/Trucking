"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import type { DriverFormState } from "@/app/(app)/my/actions";
import { createClient } from "@/lib/supabase/client";
import { compressImage, receiptPath } from "@/lib/image";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";

type Option = { id: string; label: string };

type Props = {
  userId: string;
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
export function DriverExpenseForm({ userId, trips, categories, today, initial = {}, action, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = pending || uploading;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(null);
    const formData = new FormData(event.currentTarget);
    formData.delete("photo");
    const file = fileRef.current?.files?.[0];
    if (file) {
      setUploading(true);
      try {
        const blob = await compressImage(file);
        const path = receiptPath(userId, blob);
        const { error } = await createClient().storage.from("receipts").upload(path, blob, {
          contentType: blob.type || "image/jpeg",
          upsert: false,
        });
        if (error) throw error;
        formData.set("receipt_path", path);
      } catch {
        setUploading(false);
        setUploadError("تعذر رفع صورة الإيصال. تحقق من الاتصال وحاول مرة أخرى.");
        return;
      }
      setUploading(false);
    }
    startTransition(() => formAction(formData));
  }

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

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">صورة الإيصال</span>
          {preview ? (
            <div className="relative w-fit">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file */}
              <img src={preview} alt="معاينة الإيصال" className="max-h-56 rounded-lg border border-border" />
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
                className="absolute end-1 top-1 rounded-full bg-surface p-1 shadow"
                aria-label="إزالة الصورة"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          ) : null}
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted hover:bg-surface-2">
            <Camera className="size-5" aria-hidden />
            {preview ? "تغيير الصورة" : initial.hasReceipt ? "استبدال الصورة المرفقة" : "تصوير الإيصال"}
            <input
              ref={fileRef}
              name="photo"
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
            />
          </label>
        </div>
      </fieldset>
      <FormError message={uploadError ?? state.error} />
      <Button type="submit" disabled={busy} className="w-full py-3 text-base">
        {uploading ? "جارٍ رفع الصورة…" : pending ? "جارٍ الحفظ…" : submitLabel}
      </Button>
    </form>
  );
}
