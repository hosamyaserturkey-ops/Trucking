"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getEntity, TRUCK_ASSETS } from "@/lib/master-data";
import { describeDbError, parseEntityForm } from "@/lib/master-data-parse";
import { untypedClient } from "@/lib/master-data-server";

export type SaveState = { error: string | null };

/**
 * Create or update a master data record. `key` picks the config; `id` is null
 * for a new record. RLS is the real gate; requireRole keeps the message clear.
 */
export async function saveEntity(key: string, id: string | null, _prev: SaveState, formData: FormData): Promise<SaveState> {
  const entity = key === "truck_assets" ? TRUCK_ASSETS : getEntity(key);
  if (!entity) return { error: "نوع بيانات غير معروف" };
  await requireRole(...entity.writeRoles);

  const parsed = parseEntityForm(entity.fields, (name) => {
    const v = formData.get(name);
    return typeof v === "string" ? v : null;
  });
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await untypedClient();
  let result;
  if (entity.pk === "truck_id") {
    if (!id) return { error: "الشاحنة غير محددة" };
    result = await supabase.from(entity.table).upsert({ truck_id: id, ...parsed.values }).select(entity.pk);
  } else if (id) {
    result = await supabase.from(entity.table).update(parsed.values).eq("id", id).select("id");
  } else {
    result = await supabase.from(entity.table).insert(parsed.values).select("id");
  }

  if (result.error) return { error: describeDbError(result.error) };
  // An update hidden by RLS changes nothing and returns no rows rather than an error.
  if (!result.data?.length) return { error: "لا تملك صلاحية تعديل هذا السجل" };

  revalidatePath("/", "layout");
  redirect(entity.key === "truck_assets" ? `/master/trucks/${id}` : `/master/${entity.key}`);
}
