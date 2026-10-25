"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { homeFor } from "@/lib/roles";

export type SignInState = { error: string | null };

const credentials = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "أدخل بريداً إلكترونياً وكلمة مرور صحيحين" };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" };

  // Go straight to the role's home page (drivers -> /my, no role yet -> /pending).
  const { data: profile } = await supabase.from("profiles").select("role").eq("user_id", data.user.id).maybeSingle();
  redirect(profile?.role ? homeFor(profile.role) : "/pending");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
