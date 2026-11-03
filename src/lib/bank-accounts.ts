import { createClient } from "@/lib/supabase/server";

export type BankOption = { id: string; label: string };

/**
 * The company's active bank accounts for a form: the main account 1102 first,
 * then its sub-accounts. A form shows the choice only when there is more than one.
 */
export async function loadBankAccounts(): Promise<BankOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("accounts")
    .select("id, code, name_ar, bank_account_no, is_active")
    .like("code", "1102%")
    .eq("is_postable", true)
    .eq("type", "asset")
    .order("code");
  return (data ?? [])
    .filter((a) => a.is_active)
    .map((a) => ({ id: a.id, label: `${a.name_ar}${a.bank_account_no ? ` · ${a.bank_account_no}` : ""}` }));
}
