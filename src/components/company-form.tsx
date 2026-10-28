"use client";

import { useActionState } from "react";
import type { CompanySaveState } from "@/app/(app)/settings/company/actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/form";

type Values = { company_name: string; tax_number: string | null; address: string | null; phone: string | null; vat_rate_pct: number };

export function CompanyForm({ action, initial }: { action: (prev: CompanySaveState, formData: FormData) => Promise<CompanySaveState>; initial: Values }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="اسم الشركة" htmlFor="company_name">
          <Input id="company_name" name="company_name" defaultValue={initial.company_name} required />
        </Field>
        <Field label="الرقم الضريبي" htmlFor="tax_number">
          <Input id="tax_number" name="tax_number" dir="ltr" defaultValue={initial.tax_number ?? ""} />
        </Field>
        <Field label="العنوان" htmlFor="address">
          <Input id="address" name="address" defaultValue={initial.address ?? ""} />
        </Field>
        <Field label="الهاتف" htmlFor="phone">
          <Input id="phone" name="phone" dir="ltr" defaultValue={initial.phone ?? ""} />
        </Field>
        <Field label="نسبة ضريبة المبيعات (%)" htmlFor="vat_rate_pct" hint="تُطبّق على الفواتير الجديدة فقط؛ الزبون المعفى لا تُضاف عليه">
          <Input id="vat_rate_pct" name="vat_rate_pct" inputMode="decimal" dir="ltr" defaultValue={String(initial.vat_rate_pct)} required />
        </Field>
      </div>
      <FormError message={state.error} />
      {state.saved ? (
        <p role="status" className="text-sm text-success">
          تم الحفظ.
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : "حفظ"}
        </Button>
      </div>
    </form>
  );
}
