"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { parseAdvance, parseLoadPay } from "@/lib/advances";
import { bankAccountFor } from "@/lib/bank";
import { describeDbError } from "@/lib/master-data-parse";

export type AdvanceFormState = { error: string | null; done?: boolean };

const fromForm = (formData: FormData) => (name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v : null;
};

function dbMessage(error: { code?: string; message: string }): string {
  if (error.code === "P0001" || error.code === "23514" || error.code === "P0002" || error.code === "42501") return error.message;
  return describeDbError(error);
}

/** Hand a cash or bank advance to a driver. */
export async function issueAdvance(_prev: AdvanceFormState, formData: FormData): Promise<AdvanceFormState> {
  await requireRole(...FINANCE_ROLES);
  const parsed = parseAdvance(fromForm(formData), { today: todayIso() });
  if (!parsed.ok) return { error: parsed.error };
  const supabase = await createClient();
  const { error } = await supabase
    .from("driver_advances")
    .insert({ ...parsed.values, bank_account_id: bankAccountFor(parsed.values.method, fromForm(formData)("bank_account_id")) });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/advances", "layout");
  return { error: null, done: true };
}

/** Close every open movement up to a date; the database computes the totals. */
export async function settleDriver(driverId: string, _prev: AdvanceFormState, formData: FormData): Promise<AdvanceFormState> {
  await requireRole(...FINANCE_ROLES);
  const get = fromForm(formData);
  const today = todayIso();
  const settledOn = (get("settled_on") ?? "").trim() || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(settledOn)) return { error: "التاريخ غير صحيح" };
  if (settledOn > today) return { error: "لا يمكن التسوية بتاريخ لاحق" };
  const notes = (get("notes") ?? "").trim();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("settle_driver_advance", {
    p_driver_id: driverId,
    p_settled_on: settledOn,
    ...(notes ? { p_notes: notes } : {}),
  });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/advances", "layout");
  redirect(`/advances/${driverId}?settled=${data}`);
}

/** Price one finished load for its driver (or clear the price); his balance follows at once. */
export async function priceLoad(tripId: string, _prev: AdvanceFormState, formData: FormData): Promise<AdvanceFormState> {
  await requireRole(...FINANCE_ROLES);
  const parsed = parseLoadPay(fromForm(formData));
  if (!parsed.ok) return { error: parsed.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_load_driver_pay", {
    p_trip_id: tripId,
    p_amount_minor: parsed.values.amount_minor,
    p_notes: parsed.values.notes ?? "",
  });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/advances", "layout");
  return { error: null, done: true };
}
