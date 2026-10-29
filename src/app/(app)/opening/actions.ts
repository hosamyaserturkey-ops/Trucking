"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { parseOpeningAdvance, parseOpeningBalance, parseOpeningCheque, parseOpeningDate, type OpeningKind } from "@/lib/opening";
import { describeDbError } from "@/lib/master-data-parse";

export type OpeningFormState = { error: string | null; done?: boolean };

const fromForm = (formData: FormData) => (name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v : null;
};

function dbMessage(error: { code?: string; message: string }): string {
  if (["P0001", "23514", "42501"].includes(error.code ?? "")) return error.message;
  return describeDbError(error);
}

function refresh() {
  revalidatePath("/opening");
  revalidatePath("/receivables", "layout");
  revalidatePath("/payables");
  revalidatePath("/advances", "layout");
  revalidatePath("/ledger", "layout");
}

async function openingDate(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("company_settings").select("opening_date").maybeSingle();
  return data?.opening_date ?? null;
}

/** The first day in the system; moving it moves the opening entry, cheques and advances. */
export async function setOpeningDate(_prev: OpeningFormState, formData: FormData): Promise<OpeningFormState> {
  await requireRole(...FINANCE_ROLES);
  if (formData.get("clear") === "1") {
    // Only while no balance, cheque or advance hangs on it (the database refuses otherwise).
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_opening_date", { p_date: null as unknown as string });
    if (error) return { error: dbMessage(error) };
    refresh();
    return { error: null, done: true };
  }
  const parsed = parseOpeningDate(fromForm(formData)("opening_date") ?? "", todayIso());
  if (!parsed.ok) return { error: parsed.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_opening_date", { p_date: parsed.date });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { error: null, done: true };
}

const TARGET: Record<OpeningKind, "account_id" | "client_id" | "supplier_id"> = {
  account: "account_id",
  client: "client_id",
  supplier: "supplier_id",
};

/** A balance for an account, customer or supplier; entering one again replaces it. */
export async function saveOpeningBalance(kind: OpeningKind, _prev: OpeningFormState, formData: FormData): Promise<OpeningFormState> {
  await requireRole(...FINANCE_ROLES);
  const parsed = parseOpeningBalance(kind, fromForm(formData));
  if (!parsed.ok) return { error: parsed.error };
  const { target_id, ...amount } = parsed.values;
  const supabase = await createClient();
  const column = TARGET[kind];
  const { data: existing } = await supabase.from("opening_balances").select("id").eq("kind", kind).eq(column, target_id).maybeSingle();
  const { error } = existing
    ? await supabase.from("opening_balances").update(amount).eq("id", existing.id)
    : await supabase.from("opening_balances").insert({ kind, [column]: target_id, ...amount });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { error: null, done: true };
}

export async function deleteOpeningBalance(id: string): Promise<OpeningFormState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { data, error } = await supabase.from("opening_balances").delete().eq("id", id).select("id");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "تعذر الحذف" };
  refresh();
  return { error: null, done: true };
}

/** An advance the driver still holds on the opening date; settled later like any advance. */
export async function saveOpeningAdvance(_prev: OpeningFormState, formData: FormData): Promise<OpeningFormState> {
  await requireRole(...FINANCE_ROLES);
  const parsed = parseOpeningAdvance(fromForm(formData));
  if (!parsed.ok) return { error: parsed.error };
  const date = await openingDate();
  if (!date) return { error: "حدد تاريخ بدء العمل أولاً" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("driver_advances")
    .insert({ ...parsed.values, issued_on: date, method: "opening", notes: "عهدة من الأرصدة الافتتاحية" });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { error: null, done: true };
}

export async function deleteOpeningAdvance(id: string): Promise<OpeningFormState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { data, error } = await supabase.from("driver_advances").delete().eq("id", id).eq("method", "opening").select("id");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "تعذر الحذف" };
  refresh();
  return { error: null, done: true };
}

/** A customer cheque still in hand ("in"), or our cheque not yet paid by the bank ("out"). */
export async function saveOpeningCheque(direction: "in" | "out", _prev: OpeningFormState, formData: FormData): Promise<OpeningFormState> {
  await requireRole(...FINANCE_ROLES);
  const parsed = parseOpeningCheque(fromForm(formData));
  if (!parsed.ok) return { error: parsed.error };
  const date = await openingDate();
  if (!date) return { error: "حدد تاريخ بدء العمل أولاً" };
  const { party_id, ...cheque } = parsed.values;
  const supabase = await createClient();
  const { error } =
    direction === "in"
      ? await supabase.from("client_receipts").insert({
          client_id: party_id,
          received_on: date,
          method: "cheque",
          cheque_status: "in_hand",
          is_opening: true,
          notes: "شيك من الأرصدة الافتتاحية",
          ...cheque,
        })
      : await supabase.from("supplier_payments").insert({
          supplier_id: party_id,
          paid_on: date,
          method: "cheque",
          cheque_status: "issued",
          is_opening: true,
          notes: "شيك من الأرصدة الافتتاحية",
          ...cheque,
        });
  if (error) return { error: dbMessage(error) };
  refresh();
  revalidatePath(direction === "in" ? "/receipts" : "/payments");
  return { error: null, done: true };
}

export async function deleteOpeningCheque(direction: "in" | "out", id: string): Promise<OpeningFormState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { data, error } =
    direction === "in"
      ? await supabase.from("client_receipts").delete().eq("id", id).eq("is_opening", true).select("id")
      : await supabase.from("supplier_payments").delete().eq("id", id).eq("is_opening", true).select("id");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "تعذر الحذف" };
  refresh();
  revalidatePath(direction === "in" ? "/receipts" : "/payments");
  return { error: null, done: true };
}
