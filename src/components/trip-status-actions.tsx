"use client";

import { useActionState } from "react";
import type { TripFormState } from "@/app/(app)/trips/actions";
import { Button } from "@/components/ui/button";
import { FormError, Input } from "@/components/ui/form";

type Action = (prev: TripFormState, formData: FormData) => Promise<TripFormState>;

/** Start or finish form: odometer + date, with the server's message if it refuses. */
export function OdometerAction({
  action,
  label,
  odometerHint,
  defaultOdometer,
  defaultDate,
}: {
  action: Action;
  label: string;
  odometerHint?: string;
  defaultOdometer?: number | null;
  defaultDate: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          قراءة العداد (كم)
          <Input
            name="odometer"
            inputMode="numeric"
            dir="ltr"
            defaultValue={defaultOdometer?.toString() ?? ""}
            className="w-36"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          التاريخ
          <Input name="date" type="date" dir="ltr" defaultValue={defaultDate} className="w-40" required />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "…" : label}
        </Button>
      </div>
      {odometerHint ? <p className="text-xs text-muted">{odometerHint}</p> : null}
      <FormError message={state.error} />
    </form>
  );
}

export function CancelTripButton({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm("إلغاء هذه الرحلة؟ لا يمكن التراجع عن الإلغاء.")) e.preventDefault();
      }}
      className="flex flex-col gap-2"
    >
      <Button type="submit" variant="secondary" disabled={pending} className="text-danger">
        إلغاء الرحلة
      </Button>
      <FormError message={state.error} />
    </form>
  );
}
