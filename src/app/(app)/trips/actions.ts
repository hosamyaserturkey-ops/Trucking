"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { TRIP_WRITERS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { parseOdometer, parseTripForm } from "@/lib/trip-parse";
import { describeDbError } from "@/lib/master-data-parse";
import type { TablesUpdate } from "@/types/database";

export type TripFormState = { error: string | null };

function tripError(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "توجد رحلة جارية أخرى لهذه الشاحنة أو لهذا السائق؛ أنهِها أولاً";
  if (error.code === "P0001" || error.code === "23514") return error.message;
  return describeDbError(error);
}

const fromForm = (formData: FormData) => (name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v : null;
};

/** Create a trip (id null) or edit one. Status changes go through changeTripStatus. */
export async function saveTrip(id: string | null, _prev: TripFormState, formData: FormData): Promise<TripFormState> {
  await requireRole(...TRIP_WRITERS);
  const parsed = parseTripForm(fromForm(formData));
  if (!parsed.ok) return { error: parsed.error };
  const supabase = await createClient();

  let tripId = id;
  if (id) {
    // Status only changes through changeTripStatus; keep the stored reading if the field was left empty.
    const { start_odometer, ...rest } = parsed.values;
    const fields = { ...rest, status: undefined };
    const update = start_odometer === null ? fields : { ...fields, start_odometer };
    const { data, error } = await supabase.from("trips").update(update).eq("id", id).select("id");
    if (error) return { error: tripError(error) };
    if (!data?.length) return { error: "لا تملك صلاحية تعديل هذه الرحلة" };
  } else {
    const { data, error } = await supabase.from("trips").insert(parsed.values).select("id").single();
    if (error) return { error: tripError(error) };
    tripId = data.id;
  }

  revalidatePath("/", "layout");
  redirect(`/trips/${tripId}`);
}

/** Office staff start, finish or cancel a trip. */
export async function changeTripStatus(
  id: string,
  action: "start" | "finish" | "cancel",
  _prev: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  await requireRole(...TRIP_WRITERS);
  const supabase = await createClient();
  const { data: trip } = await supabase
    .from("trips")
    .select("status, start_date, start_odometer")
    .eq("id", id)
    .maybeSingle();
  if (!trip) return { error: "الرحلة غير موجودة" };

  const get = fromForm(formData);
  const date = (get("date") ?? "").trim() || todayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "التاريخ غير صحيح" };

  let update: TablesUpdate<"trips">;
  if (action === "start") {
    if (trip.status !== "planned") return { error: "يمكن بدء الرحلات المخططة فقط" };
    const odo = parseOdometer(get("odometer"), null);
    if (!odo.ok) return { error: odo.error };
    update = { status: "in_progress", start_odometer: odo.value, start_date: date };
  } else if (action === "finish") {
    if (trip.status !== "in_progress") return { error: "يمكن إنهاء الرحلات الجارية فقط" };
    const odo = parseOdometer(get("odometer"), trip.start_odometer);
    if (!odo.ok) return { error: odo.error };
    if (date < trip.start_date) return { error: "تاريخ الانتهاء قبل تاريخ البدء" };
    update = { status: "completed", end_odometer: odo.value, end_date: date };
  } else {
    if (trip.status !== "planned" && trip.status !== "in_progress") return { error: "لا يمكن إلغاء هذه الرحلة" };
    update = { status: "cancelled" };
  }

  const { data, error } = await supabase.from("trips").update(update).eq("id", id).select("id");
  if (error) return { error: tripError(error) };
  if (!data?.length) return { error: "لا تملك صلاحية تعديل هذه الرحلة" };
  revalidatePath("/", "layout");
  return { error: null };
}
