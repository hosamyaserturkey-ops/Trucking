"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { parseCustomsDocument } from "@/lib/customs";
import { afterFileSaved, attachFile, removeFile } from "@/lib/file-access";
import { describeDbError } from "@/lib/master-data-parse";

export type CustomsFormState = { error: string | null };

const fromForm = (formData: FormData) => (name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v : null;
};

/** File a customs declaration (PDF or photo), on a load or on its own. */
export async function saveCustomsDocument(_prev: CustomsFormState, formData: FormData): Promise<CustomsFormState> {
  const profile = await requireRole(...STAFF_ROLES);
  const parsed = parseCustomsDocument(fromForm(formData), { userId: profile.user_id, today: todayIso() });
  if (!parsed.ok) return { error: parsed.error };
  const { receipt_upload, ...row } = parsed.values;
  const attached = await attachFile("customs_document", profile.user_id, receipt_upload);
  if (!attached.ok) return { error: attached.error };
  const supabase = await createClient();
  const { error } = await supabase.from("customs_documents").insert({ ...row, file_path: attached.path });
  if (error) {
    await removeFile("customs_document", attached.path);
    return { error: error.code === "42501" ? "لا تملك صلاحية إرفاق البيانات" : describeDbError(error) };
  }
  await afterFileSaved("customs_document", receipt_upload, null);
  revalidatePath("/customs");
  if (row.trip_id) revalidatePath(`/trips/${row.trip_id}`);
  redirect(`/customs?saved=1&q=${encodeURIComponent(row.declaration_no)}`);
}

/** Remove a declaration filed by mistake, with its file. */
export async function deleteCustomsDocument(id: string): Promise<CustomsFormState> {
  await requireRole(...STAFF_ROLES);
  const supabase = await createClient();
  const { data, error } = await supabase.from("customs_documents").delete().eq("id", id).select("file_path, trip_id");
  if (error) return { error: describeDbError(error) };
  if (!data?.length) return { error: "تعذر حذف البيان" };
  await removeFile("customs_document", data[0].file_path);
  revalidatePath("/customs");
  if (data[0].trip_id) revalidatePath(`/trips/${data[0].trip_id}`);
  return { error: null };
}
