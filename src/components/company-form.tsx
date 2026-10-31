"use client";

import { useActionState } from "react";
import type { CompanySaveState } from "@/app/(app)/settings/company/actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/form";

type Values = {
  company_name: string;
  tax_number: string | null;
  address: string | null;
  phone: string | null;
  vat_rate_pct: number;
  customs_portal_url: string | null;
  jofotara_income_source: string | null;
};

export function CompanyForm({
  action,
  initial,
  jofotaraLinked,
}: {
  action: (prev: CompanySaveState, formData: FormData) => Promise<CompanySaveState>;
  initial: Values;
  jofotaraLinked: boolean;
}) {
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
        <Field label="رابط نظام الاستفسار الجمركي" htmlFor="customs_portal_url" hint="يفتحه زر «فتح نظام الاستفسار الجمركي»؛ الصق رابط صفحة الدخول بالضبط">
          <Input id="customs_portal_url" name="customs_portal_url" dir="ltr" defaultValue={initial.customs_portal_url ?? ""} placeholder="https://" />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-semibold">الفوترة الإلكترونية (جوفوترة)</legend>
        <Field
          label="تسلسل مصدر الدخل"
          htmlFor="jofotara_income_source"
          hint="من بوابة نظام الفوترة الوطني بعد تسجيل نشاط الشركة؛ يُرسل مع كل فاتورة. الرقم الضريبي أعلاه هو رقم البائع."
        >
          <Input id="jofotara_income_source" name="jofotara_income_source" inputMode="numeric" dir="ltr" defaultValue={initial.jofotara_income_source ?? ""} className="sm:max-w-xs" />
        </Field>
        <p className={`text-sm ${jofotaraLinked ? "text-success" : "text-muted"}`}>
          {jofotaraLinked
            ? "رمزا الربط (Client ID و Secret Key) مضبوطان على الخادم."
            : "رمزا الربط (Client ID و Secret Key) غير مضبوطين بعد: يُوضعان كأسرار على الخادم (JOFOTARA_CLIENT_ID و JOFOTARA_SECRET_KEY)، ولا يُحفظان في قاعدة البيانات."}
        </p>
      </fieldset>
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
