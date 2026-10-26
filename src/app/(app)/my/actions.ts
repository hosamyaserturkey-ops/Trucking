"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { parseOdometer } from "@/lib/trip-parse";
import { DRIVER_CATEGORY_CODES, parseDriverExpense } from "@/lib/driver-expense";
import { describeDbError } from "@/lib/master-data-parse";
import { afterFileSaved, attachFile, removeFile } from "@/lib/file-access";

export type DriverFormState = { error: string | null };

const fromForm = (formData: FormData) => (name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v : null;
};

function dbMessage(error: { code?: string; message: string }): string {
  if (error.code === "P0001" || error.code === "23514" || error.code === "42501" || error.code === "P0002") {
    return error.message;
  }
  return describeDbError(error);
}

/** Driver starts or finishes their own trip (database checks ownership and readings). */
export async function driverTripAction(
  tripId: string,
  action: "start" | "finish",
  _prev: DriverFormState,
  formData: FormData,
): Promise<DriverFormState> {
  await requireRole("driver");
  const odo = parseOdometer(fromForm(formData)("odometer"), null);
  if (!odo.ok) return { error: odo.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("driver_trip_action", { p_trip_id: tripId, p_action: action, p_odometer: odo.value });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/my");
  return { error: null };
}

/** Submit (id null) or correct a driver expense. It waits for approval. */
export async function saveDriverExpense(id: string | null, _prev: DriverFormState, formData: FormData): Promise<DriverFormState> {
  const profile = await requireRole("driver");
  if (!profile.driver_id) return { error: "حسابك غير مرتبط بسجل سائق" };
  const supabase = await createClient();

  const { data: categories } = await supabase
    .from("expense_categories")
    .select("id, code, name_ar")
    .in("code", [...DRIVER_CATEGORY_CODES]);
  const parsed = parseDriverExpense(fromForm(formData), {
    userId: profile.user_id,
    allowedCategoryIds: (categories ?? []).map((c) => c.id),
    today: todayIso(),
  });
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.values;

  // The truck comes from the trip, so a driver never picks it by hand.
  const { data: trip } = await supabase.from("trips").select("truck_id").eq("id", v.trip_id).maybeSingle();
  if (!trip) return { error: "الرحلة غير موجودة" };

  let fx_rate = 1;
  if (v.currency !== "JOD") {
    const { data: cur } = await supabase.from("currencies").select("rate_to_base").eq("code", v.currency).maybeSingle();
    fx_rate = Number(cur?.rate_to_base ?? 0);
    if (!fx_rate) return { error: "لا يوجد سعر صرف لهذه العملة؛ تواصل مع المحاسب" };
  }

  const row = {
    expense_date: v.expense_date,
    category_id: v.category_id,
    cost_scope: "truck",
    truck_id: trip.truck_id,
    trip_id: v.trip_id,
    driver_id: profile.driver_id,
    description: v.description ?? categories?.find((c) => c.id === v.category_id)?.name_ar ?? "مصروف",
    currency: v.currency,
    amount_minor: v.amount_minor,
    fx_rate,
    payment_method: v.payment_method,
    status: "submitted",
  };

  // A new photo was uploaded straight to storage; check it and move it into place.
  let receipt_path: string | null = null;
  if (v.receipt_upload) {
    const attached = await attachFile("expense_receipt", profile.user_id, v.receipt_upload);
    if (!attached.ok) return { error: attached.error };
    receipt_path = attached.path;
  }

  if (id) {
    const { data: old } = await supabase.from("expenses").select("receipt_path").eq("id", id).maybeSingle();
    const update = receipt_path ? { ...row, receipt_path } : row;
    const { data, error } = await supabase.from("expenses").update(update).eq("id", id).eq("status", "submitted").select("id");
    if (error || !data?.length) {
      await removeFile("expense_receipt", receipt_path);
      return { error: error ? dbMessage(error) : "لا يمكن تعديل هذا المصروف (ربما تمت مراجعته)" };
    }
    await afterFileSaved("expense_receipt", v.receipt_upload, receipt_path ? old?.receipt_path : null);
  } else {
    const { error } = await supabase.from("expenses").insert({ ...row, receipt_path });
    if (error) {
      await removeFile("expense_receipt", receipt_path);
      return { error: dbMessage(error) };
    }
    await afterFileSaved("expense_receipt", v.receipt_upload, null);
  }

  revalidatePath("/my");
  redirect("/my?saved=1");
}

/** Withdraw an expense that has not been reviewed yet. */
export async function deleteDriverExpense(id: string): Promise<DriverFormState> {
  await requireRole("driver");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", id)
    .eq("status", "submitted")
    .select("id, receipt_path");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "لا يمكن حذف هذا المصروف" };
  await removeFile("expense_receipt", data[0].receipt_path);
  revalidatePath("/my");
  return { error: null };
}
