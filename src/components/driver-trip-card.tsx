"use client";

import { useActionState } from "react";
import type { DriverFormState } from "@/app/(app)/my/actions";
import { Button } from "@/components/ui/button";
import { FormError, Input } from "@/components/ui/form";

/** Big, simple start/finish control for the driver's phone. */
export function DriverTripControl({
  action,
  label,
  hint,
  defaultOdometer,
}: {
  action: (prev: DriverFormState, formData: FormData) => Promise<DriverFormState>;
  label: string;
  hint?: string;
  defaultOdometer?: number | null;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm font-medium">
        قراءة العداد الآن (كم)
        <Input
          name="odometer"
          inputMode="numeric"
          dir="ltr"
          defaultValue={defaultOdometer?.toString() ?? ""}
          className="text-lg"
          required
        />
      </label>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      <FormError message={state.error} />
      <Button type="submit" disabled={pending} className="w-full py-3 text-base">
        {pending ? "…" : label}
      </Button>
    </form>
  );
}

export function WithdrawExpenseButton({
  action,
}: {
  action: (prev: DriverFormState) => Promise<DriverFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm("حذف هذا المصروف؟")) e.preventDefault();
      }}
    >
      <button type="submit" disabled={pending} className="text-xs text-danger hover:underline">
        حذف
      </button>
      {state.error ? <span className="ms-2 text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}
