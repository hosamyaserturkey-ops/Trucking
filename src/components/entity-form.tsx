"use client";

import type { ReactNode } from "react";
import type { FieldDef } from "@/lib/master-data";
import type { UploadPurpose } from "@/lib/file-access";
import type { SaveState } from "@/app/(app)/master/actions";
import { useReceiptAction } from "@/components/receipt-input";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/form";

type Props = {
  fields: FieldDef[];
  values: Record<string, unknown>;
  refOptions: Record<string, { value: string; label: string }[]>;
  action: (prev: SaveState, formData: FormData) => Promise<SaveState>;
  submitLabel: string;
  readOnly?: boolean;
  /** More inputs below the fields, such as a licence; a chosen file ("photo") is uploaded first. */
  extra?: ReactNode;
  uploadPurpose?: UploadPurpose;
};

/** Money comes from the database in fils; the form shows dinars with 3 decimals. */
function display(field: FieldDef, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (field.type === "money") {
    const fils = BigInt(value as number);
    const sign = fils < 0n ? "-" : "";
    const abs = fils < 0n ? -fils : fils;
    return `${sign}${abs / 1000n}.${(abs % 1000n).toString().padStart(3, "0")}`;
  }
  return String(value);
}

export function EntityForm({ fields, values, refOptions, action, submitLabel, readOnly, extra, uploadPurpose }: Props) {
  // Without a file input this is a plain submit; with one, the file goes to storage first.
  const { busy, uploading, pending, error, onSubmit } = useReceiptAction(action, uploadPurpose ?? "truck_document");

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <fieldset disabled={readOnly || busy} className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => {
          const id = `f-${f.name}`;
          const value = display(f, values[f.name]);
          if (f.type === "bool") {
            return (
              <label key={f.name} className="flex items-center gap-2 self-end py-2 text-sm font-medium">
                <input
                  id={id}
                  name={f.name}
                  type="checkbox"
                  defaultChecked={values[f.name] === undefined ? f.name === "is_active" : !!values[f.name]}
                  className="size-4 accent-[var(--primary)]"
                />
                {f.label}
              </label>
            );
          }
          const label = (
            <>
              {f.label}
              {f.required ? <span className="text-danger"> *</span> : null}
            </>
          );
          if (f.type === "select" || f.type === "ref") {
            const options = f.type === "select" ? (f.options ?? []) : (refOptions[f.name] ?? []);
            return (
              <Field key={f.name} label={label} htmlFor={id} hint={f.hint}>
                <Select id={id} name={f.name} defaultValue={value} required={f.required}>
                  {f.required ? null : <option value="">—</option>}
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            );
          }
          return (
            <Field key={f.name} label={label} htmlFor={id} hint={f.hint}>
              <Input
                id={id}
                name={f.name}
                type={f.type === "date" ? "date" : "text"}
                inputMode={f.type === "int" ? "numeric" : f.type === "decimal" || f.type === "money" ? "decimal" : undefined}
                dir={f.ltr || f.type !== "text" ? "ltr" : undefined}
                defaultValue={value}
                required={f.required}
              />
            </Field>
          );
        })}
      </fieldset>
      {extra ? <fieldset disabled={readOnly || busy}>{extra}</fieldset> : null}
      <FormError message={error} />
      {readOnly ? null : (
        <div>
          <Button type="submit" disabled={busy}>
            {uploading ? "جارٍ رفع الملف…" : pending ? "جارٍ الحفظ…" : submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
