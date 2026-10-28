"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getEntity, TRUCK_ASSETS } from "@/lib/master-data";
import { describeDbError, parseEntityForm } from "@/lib/master-data-parse";
import { untypedClient } from "@/lib/master-data-server";
import { afterFileSaved, attachFile, decideUpload, removeFile } from "@/lib/file-access";
import { licenceUpload, parseTruckLicence, type TruckLicence } from "@/lib/licence";

export type SaveState = { error: string | null };

/**
 * Save a truck's licence (رخصة المركبة) as its current registration document:
 * the latest one is updated, or the first one created. Returns an error message.
 */
async function saveTruckLicence(
  supabase: SupabaseClient,
  truckId: string,
  licence: TruckLicence | null,
  uploadKey: string | null,
  userId: string,
): Promise<string | null> {
  const { data: current } = await supabase
    .from("truck_documents")
    .select("id, doc_number, expiry_date, file_path")
    .eq("truck_id", truckId)
    .eq("doc_type", "registration")
    .order("expiry_date", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const unchanged = current && licence && current.doc_number === licence.doc_number && current.expiry_date === licence.expiry_date;
  if (!uploadKey && (!licence || unchanged)) return null;

  let path: string | null = null;
  if (uploadKey) {
    const attached = await attachFile("truck_document", userId, uploadKey);
    if (!attached.ok) return attached.error;
    path = attached.path;
  }
  const row = { ...(licence ?? {}), ...(path ? { file_path: path } : {}) };
  const res = current
    ? await supabase.from("truck_documents").update(row).eq("id", current.id).select("id")
    : await supabase.from("truck_documents").insert({ truck_id: truckId, doc_type: "registration", ...row }).select("id");
  if (res.error || !res.data?.length) {
    await removeFile("truck_document", path);
    return res.error ? describeDbError(res.error) : "لا تملك صلاحية تعديل وثائق الشاحنة";
  }
  if (uploadKey) await afterFileSaved("truck_document", uploadKey, current?.file_path);
  return null;
}

/**
 * Create or update a master data record. `key` picks the config; `id` is null
 * for a new record. RLS is the real gate; requireRole keeps the message clear.
 * Drivers and trucks may carry their licence: the driver's scan rides on his
 * row, the truck's licence is saved as its registration document.
 */
export async function saveEntity(key: string, id: string | null, _prev: SaveState, formData: FormData): Promise<SaveState> {
  const entity = key === "truck_assets" ? TRUCK_ASSETS : getEntity(key);
  if (!entity) return { error: "نوع بيانات غير معروف" };
  const profile = await requireRole(...entity.writeRoles);

  const get = (name: string) => {
    const v = formData.get(name);
    return typeof v === "string" ? v : null;
  };
  const parsed = parseEntityForm(entity.fields, get);
  if (!parsed.ok) return { error: parsed.error };
  const values: Record<string, unknown> = { ...parsed.values };

  const licenceKind = entity.key === "drivers" ? "driver-documents" : entity.key === "trucks" ? "truck-documents" : null;
  const upload = licenceKind ? licenceUpload(get, licenceKind, profile.user_id) : ({ ok: true, key: null } as const);
  if (!upload.ok) return { error: upload.error };
  const truckLicence = entity.key === "trucks" ? parseTruckLicence(get) : ({ ok: true, values: null } as const);
  if (!truckLicence.ok) return { error: truckLicence.error };
  const withTruckLicence = entity.key === "trucks" && (!!truckLicence.values || !!upload.key);
  if (withTruckLicence && !decideUpload(profile.role, "truck_document")) return { error: "لا تملك صلاحية إرفاق رخصة الشاحنة" };

  const supabase = await untypedClient();
  let driverLicence: string | null = null;
  let replacedLicence: string | null = null;
  if (entity.key === "drivers" && upload.key) {
    const attached = await attachFile("driver_license", profile.user_id, upload.key);
    if (!attached.ok) return { error: attached.error };
    driverLicence = attached.path;
    values.license_file_path = attached.path;
    if (id) replacedLicence = (await supabase.from("drivers").select("license_file_path").eq("id", id).maybeSingle()).data?.license_file_path ?? null;
  }

  let result;
  if (entity.pk === "truck_id") {
    if (!id) return { error: "الشاحنة غير محددة" };
    result = await supabase.from(entity.table).upsert({ truck_id: id, ...values }).select(entity.pk);
  } else if (id) {
    result = await supabase.from(entity.table).update(values).eq("id", id).select("id");
  } else {
    result = await supabase.from(entity.table).insert(values).select("id");
  }

  // An update hidden by RLS changes nothing and returns no rows rather than an error.
  if (result.error || !result.data?.length) {
    await removeFile("driver_license", driverLicence);
    return { error: result.error ? describeDbError(result.error) : "لا تملك صلاحية تعديل هذا السجل" };
  }
  if (driverLicence && upload.key) await afterFileSaved("driver_license", upload.key, replacedLicence);

  if (withTruckLicence) {
    const truckId = id ?? (result.data[0] as { id: string }).id;
    const err = await saveTruckLicence(supabase, truckId, truckLicence.values, upload.key, profile.user_id);
    if (err) {
      revalidatePath("/", "layout");
      return { error: `حُفظت الشاحنة، لكن تعذر حفظ رخصتها: ${err}` };
    }
  }

  revalidatePath("/", "layout");
  redirect(entity.key === "truck_assets" ? `/master/trucks/${id}` : `/master/${entity.key}`);
}
