"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { FUEL_WRITERS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { parseFillup } from "@/lib/fuel";
import { afterFileSaved, attachFile, removeFile } from "@/lib/file-access";
import { describeDbError } from "@/lib/master-data-parse";

export type FillupFormState = { error: string | null };

const fromForm = (formData: FormData) => (name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v : null;
};

function dbMessage(error: { code?: string; message: string }): string {
  if (error.code === "P0001" || error.code === "23514" || error.code === "42501") return error.message;
  return describeDbError(error);
}

/**
 * Office entry of a fill-up (id null) or a correction. The manager's and
 * accountant's entries count at once; a dispatcher's go to approval.
 */
export async function saveOfficeFillup(id: string | null, _prev: FillupFormState, formData: FormData): Promise<FillupFormState> {
  const profile = await requireRole(...FUEL_WRITERS);
  const parsed = parseFillup(fromForm(formData), { mode: "office", userId: profile.user_id });
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.values;
  const supabase = await createClient();

  let fx_rate = v.fx_rate;
  if (fx_rate === null) {
    const { data: cur } = await supabase.from("currencies").select("rate_to_base").eq("code", v.currency).maybeSingle();
    fx_rate = Number(cur?.rate_to_base ?? 0);
    if (!fx_rate) return { error: "لا يوجد سعر صرف لهذه العملة" };
  }

  const row = {
    truck_id: v.truck_id!,
    driver_id: v.driver_id,
    trip_id: v.trip_id,
    station_id: v.station_id,
    filled_at: v.filled_at,
    odometer: v.odometer,
    qty_unit: v.qty_unit,
    quantity: v.quantity,
    unit_price_minor: v.unit_price_minor,
    is_full_tank: v.is_full_tank,
    currency: v.currency,
    fx_rate,
    payment_method: v.payment_method,
    notes: v.notes,
    voucher_no: v.voucher_no,
    notice_no: v.notice_no,
  };

  let receipt_path: string | null = null;
  if (v.receipt_upload) {
    const attached = await attachFile("fuel_receipt", profile.user_id, v.receipt_upload);
    if (!attached.ok) return { error: attached.error };
    receipt_path = attached.path;
  }

  if (id) {
    const { data: old } = await supabase.from("fuel_fillups").select("receipt_path").eq("id", id).maybeSingle();
    const update = receipt_path ? { ...row, receipt_path } : row;
    const { data, error } = await supabase.from("fuel_fillups").update(update).eq("id", id).is("settlement_id", null).select("id");
    if (error || !data?.length) {
      await removeFile("fuel_receipt", receipt_path);
      return { error: error ? dbMessage(error) : "لا يمكن تعديل هذه التعبئة" };
    }
    await afterFileSaved("fuel_receipt", v.receipt_upload, receipt_path ? old?.receipt_path : null);
  } else {
    // The database recomputes the cost (quantity x unit price) on every write.
    const { error } = await supabase.from("fuel_fillups").insert({ ...row, amount_minor: v.amount_minor, receipt_path });
    if (error) {
      await removeFile("fuel_receipt", receipt_path);
      return { error: dbMessage(error) };
    }
    await afterFileSaved("fuel_receipt", v.receipt_upload, null);
  }

  revalidatePath("/", "layout");
  redirect("/diesel?saved=1");
}

/** Delete an unsettled fill-up (a dispatcher only while it waits); its receipt is deleted too. */
export async function deleteOfficeFillup(id: string): Promise<FillupFormState> {
  await requireRole(...FUEL_WRITERS);
  const supabase = await createClient();
  const { data, error } = await supabase.from("fuel_fillups").delete().eq("id", id).is("settlement_id", null).select("id, receipt_path");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "لا يمكن حذف هذه التعبئة" };
  await removeFile("fuel_receipt", data[0].receipt_path);
  revalidatePath("/", "layout");
  redirect("/diesel");
}
