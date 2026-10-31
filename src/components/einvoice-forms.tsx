"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";
import type { EinvoiceState } from "@/app/(app)/invoices/actions";
import { Button } from "@/components/ui/button";

/** Send to JoFotara, after a confirmation: an accepted invoice is reported to the tax department for good. */
export function SendEinvoiceButton({ action, label, confirmText }: { action: () => Promise<EinvoiceState>; label: string; confirmText: string }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(confirmText)) e.preventDefault();
      }}
      className="flex flex-col gap-2"
    >
      <div>
        <Button type="submit" disabled={pending}>
          <Send className="size-4" aria-hidden />
          {pending ? "جارٍ الإرسال إلى نظام الفوترة…" : label}
        </Button>
      </div>
      {state.error ? (
        <p role="alert" className="whitespace-pre-line rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.done && state.message ? (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
