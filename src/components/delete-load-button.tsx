"use client";

import { Trash2 } from "lucide-react";

/** Delete one loading sheet line after a confirmation. */
export function DeleteLoadButton({ action, label }: { action: () => Promise<void>; label: string }) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`حذف النقلة ${label}؟ رقم الإشارة لن يُعاد استخدامه.`)) e.preventDefault();
      }}
      className="inline"
    >
      <button type="submit" className="inline-flex text-muted hover:text-danger" aria-label={`حذف النقلة ${label}`}>
        <Trash2 className="size-4" aria-hidden />
      </button>
    </form>
  );
}
