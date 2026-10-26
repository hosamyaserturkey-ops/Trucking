"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import type { UploadPurpose } from "@/lib/file-access";
import { uploadFile } from "@/lib/upload-client";

export type FormState = { error: string | null };

/**
 * Wraps a server action so the form's receipt photo ("photo" field) is shrunk
 * and uploaded straight to storage first; the action then gets its upload key
 * as "receipt_upload". Used by every form that carries a receipt.
 */
export function useReceiptAction(
  action: (prev: FormState, formData: FormData) => Promise<FormState>,
  purpose: UploadPurpose,
  recordId?: string | null,
) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(null);
    const formData = new FormData(event.currentTarget);
    const photo = formData.get("photo");
    formData.delete("photo");
    if (photo instanceof File && photo.size > 0) {
      // Straight from the phone to storage, through a short-lived link the server signs.
      setUploading(true);
      const uploaded = await uploadFile(photo, purpose, recordId);
      setUploading(false);
      if (!uploaded.ok) {
        setUploadError(uploaded.error);
        return;
      }
      formData.set("receipt_upload", uploaded.key);
    }
    startTransition(() => formAction(formData));
  }

  return { state, pending, uploading, busy: pending || uploading, error: uploadError ?? state.error, onSubmit };
}

/** Camera/file picker with a preview. The file goes out as the "photo" field. */
export function ReceiptInput({ hasExisting = false, label = "صورة الإيصال" }: { hasExisting?: boolean; label?: string }) {
  const [preview, setPreview] = useState<{ url: string; isImage: boolean; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      {preview ? (
        <div className="relative w-fit">
          {preview.isImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
            <img src={preview.url} alt="معاينة الإيصال" className="max-h-56 rounded-lg border border-border" />
          ) : (
            <p className="rounded-lg border border-border px-3 py-2 text-sm" dir="ltr">
              {preview.name}
            </p>
          )}
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
        {preview ? "تغيير الصورة" : hasExisting ? "استبدال الصورة المرفقة" : "تصوير الإيصال"}
        <input
          ref={fileRef}
          name="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,application/pdf,image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            setPreview(f ? { url: URL.createObjectURL(f), isImage: f.type.startsWith("image/"), name: f.name } : null);
          }}
        />
      </label>
    </div>
  );
}
