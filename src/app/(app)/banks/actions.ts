"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { parseBankMovement } from "@/lib/bank";
import { describeDbError } from "@/lib/master-data-parse";

export type BankFormState = { error: string | null; done?: boolean };

const fromForm = (formData: FormData) => (name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v : null;
};

function dbMessage(error: { code?: string; message: string }): string {
  if (["P0001", "P0002", "23514", "42501"].includes(error.code ?? "")) return error.message;
  return describeDbError(error);
}

function refresh() {
  revalidatePath("/banks", "layout");
  revalidatePath("/bank", "layout");
  revalidatePath("/ledger", "layout");
}

/** A new bank account under 1102 (numbered by the database). */
export async function createBankAccount(_prev: BankFormState, formData: FormData): Promise<BankFormState> {
  await requireRole(...FINANCE_ROLES);
  const get = fromForm(formData);
  const name = (get("name") ?? "").trim();
  if (!name) return { error: "اكتب اسم الحساب البنكي، مثل: البنك العربي — جاري" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_bank_account", { p_name: name, p_account_no: (get("account_no") ?? "").trim() });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { error: null, done: true };
}

/** Rename a bank account or change its number. */
export async function updateBankAccount(accountId: string, _prev: BankFormState, formData: FormData): Promise<BankFormState> {
  await requireRole(...FINANCE_ROLES);
  const get = fromForm(formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_bank_account", {
    p_account_id: accountId,
    p_name: (get("name") ?? "").trim(),
    p_account_no: (get("account_no") ?? "").trim(),
  });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { error: null, done: true };
}

/** A deposit, withdrawal, transfer or charge on a bank account; the database posts it. */
export async function saveBankMovement(bankAccountId: string, _prev: BankFormState, formData: FormData): Promise<BankFormState> {
  await requireRole(...FINANCE_ROLES);
  const parsed = parseBankMovement(fromForm(formData), { today: todayIso() });
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.values;
  const supabase = await createClient();
  let counter = v.counter_account_id;
  if (v.counter_code) {
    const { data } = await supabase.from("accounts").select("id").eq("code", v.counter_code).maybeSingle();
    if (!data) return { error: `الحساب ${v.counter_code} غير موجود في دليل الحسابات` };
    counter = data.id;
  }
  const { error } = await supabase.from("bank_movements").insert({
    bank_account_id: bankAccountId,
    moved_on: v.moved_on,
    direction: v.direction,
    kind: v.kind,
    counter_account_id: counter!,
    amount_minor: v.amount_minor,
    truck_id: v.truck_id,
    reference_no: v.reference_no,
    description: v.description,
  });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { error: null, done: true };
}

/** A movement entered by mistake: deleting it reverses its entry. */
export async function deleteBankMovement(id: string): Promise<BankFormState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { data, error } = await supabase.from("bank_movements").delete().eq("id", id).select("id");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "الحركة غير موجودة" };
  refresh();
  return { error: null, done: true };
}
