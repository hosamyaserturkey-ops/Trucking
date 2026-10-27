"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { TRIP_WRITERS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { parseLoadForm } from "@/lib/loading-sheet";
import { describeDbError } from "@/lib/master-data-parse";

export type LoadFormState = { error: string | null };

const fromForm = (formData: FormData) => (name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v : null;
};

function loadError(error: { code?: string; message: string }): string {
  if (error.code === "P0001" || error.code === "23514") return error.message;
  if (error.code === "23503") return "لا يمكن حذف النقلة لأن عليها مصاريف أو ديزل مسجّلة";
  return describeDbError(error);
}

/** Add a line to the loading sheet (id null) or edit one. The database gives it the customer reference. */
export async function saveLoad(id: string | null, _prev: LoadFormState, formData: FormData): Promise<LoadFormState> {
  await requireRole(...TRIP_WRITERS);
  const parsed = parseLoadForm(fromForm(formData), todayIso());
  if (!parsed.ok) return { error: parsed.error };
  const supabase = await createClient();

  let ref: string | null;
  if (id) {
    // Only sheet lines are edited here; entry_source and status stay "sheet" and "completed".
    const { data, error } = await supabase
      .from("trips")
      .update(parsed.values)
      .eq("id", id)
      .eq("entry_source", "sheet")
      .select("client_ref");
    if (error) return { error: loadError(error) };
    if (!data?.length) return { error: "النقلة غير موجودة أو لا تملك صلاحية تعديلها" };
    ref = data[0].client_ref;
  } else {
    const { data, error } = await supabase.from("trips").insert(parsed.values).select("client_ref").single();
    if (error) return { error: loadError(error) };
    ref = data.client_ref;
  }

  revalidatePath("/", "layout");
  const params = new URLSearchParams({ date: parsed.values.start_date, saved: ref ?? "1" });
  redirect(`/loading?${params}`);
}

/** Remove a line typed by mistake. Its reference number is not given out again. */
export async function deleteLoad(id: string, date: string): Promise<void> {
  await requireRole(...TRIP_WRITERS);
  const supabase = await createClient();
  const { error } = await supabase.from("trips").delete().eq("id", id).eq("entry_source", "sheet");
  const back = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayIso();
  if (error) redirect(`/loading?${new URLSearchParams({ date: back, error: loadError(error) })}`);
  revalidatePath("/", "layout");
  redirect(`/loading?${new URLSearchParams({ date: back, deleted: "1" })}`);
}
