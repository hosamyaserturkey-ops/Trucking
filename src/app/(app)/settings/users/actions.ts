"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { describeDbError } from "@/lib/master-data-parse";

export type UserSaveState = { error: string | null; saved?: boolean };

const schema = z.object({
  full_name: z.string().trim().max(120),
  role: z.enum(["manager", "accountant", "dispatcher", "driver", ""]),
  driver_id: z.union([z.uuid(), z.literal("")]),
});

/** Managers set a user's name, role and (for drivers) the driver record they are. */
export async function saveUser(userId: string, _prev: UserSaveState, formData: FormData): Promise<UserSaveState> {
  await requireRole("manager");
  const parsed = schema.safeParse({
    full_name: formData.get("full_name") ?? "",
    role: formData.get("role") ?? "",
    driver_id: formData.get("driver_id") ?? "",
  });
  if (!parsed.success) return { error: "بيانات غير صحيحة" };
  const { full_name, role, driver_id } = parsed.data;
  if (role === "driver" && !driver_id) return { error: "اختر سجل السائق المرتبط بهذا المستخدم" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({
      full_name,
      role: role || null,
      driver_id: role === "driver" ? driver_id : null,
    })
    .eq("user_id", userId)
    .select("user_id");

  if (error) {
    if (error.message.includes("آخر مدير")) return { error: "لا يمكن إزالة آخر مدير في النظام" };
    if (error.code === "23505") return { error: "سجل السائق هذا مرتبط بمستخدم آخر" };
    return { error: describeDbError(error) };
  }
  if (!data?.length) return { error: "لا تملك صلاحية تعديل المستخدمين" };

  revalidatePath("/settings/users");
  return { error: null, saved: true };
}
