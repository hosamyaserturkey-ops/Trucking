import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homeFor, type AppRole } from "@/lib/roles";

export type Profile = {
  user_id: string;
  email: string | null;
  full_name: string;
  role: AppRole | null;
  driver_id: string | null;
};

// One lookup per request, shared by layouts, pages and actions.
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("user_id, email, full_name, role, driver_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return data;
});

export type ActiveProfile = Profile & { role: AppRole };

// Signed-out -> /login, no role yet -> /pending, wrong role -> their home page.
// The database enforces the same rules through RLS; this only keeps the UI honest.
export async function requireRole(...roles: AppRole[]): Promise<ActiveProfile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!profile.role) redirect("/pending");
  if (roles.length > 0 && !roles.includes(profile.role)) redirect(homeFor(profile.role));
  return profile as ActiveProfile;
}
