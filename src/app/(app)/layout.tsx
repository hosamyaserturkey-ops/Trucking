import { requireRole } from "@/lib/auth";
import { canSeeFinancials, navFor, ROLE_LABELS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../(auth)/actions";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireRole();
  const items = navFor(profile.role);
  const name = profile.full_name || profile.email || "";

  const counts: Record<string, number> = {};
  if (canSeeFinancials(profile.role)) {
    const supabase = await createClient();
    const [expenses, fills] = await Promise.all([
      supabase.from("expenses").select("id", { count: "exact", head: true }).eq("status", "submitted"),
      supabase.from("fuel_fillups").select("id", { count: "exact", head: true }).eq("status", "submitted"),
    ]);
    counts["/approvals"] = (expenses.count ?? 0) + (fills.count ?? 0);
  }

  return (
    <AppShell items={items} counts={counts} name={name} roleLabel={ROLE_LABELS[profile.role]} signOut={signOut}>
      {children}
    </AppShell>
  );
}
