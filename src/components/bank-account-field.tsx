import { Field, Select } from "@/components/ui/form";

export type BankOption = { id: string; label: string };

/**
 * Which bank account a payment goes into or out of. Shown only when the
 * company has more than one; otherwise everything uses the main account.
 */
export function BankAccountField({
  accounts,
  defaultValue,
  id = "bank_account_id",
  label = "الحساب البنكي",
}: {
  accounts: BankOption[];
  defaultValue?: string | null;
  id?: string;
  label?: string;
}) {
  if (accounts.length < 2) return null;
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} name="bank_account_id" defaultValue={defaultValue ?? accounts[0].id}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}
