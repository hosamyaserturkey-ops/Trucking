import { LogOut, Menu, Truck } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { canSeeFinancials, navFor, ROLE_LABELS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../(auth)/actions";
import { NavLinks } from "@/components/nav-links";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireRole();
  const items = navFor(profile.role);
  const name = profile.full_name || profile.email || "";

  const counts: Record<string, number> = {};
  if (canSeeFinancials(profile.role)) {
    const supabase = await createClient();
    const { count } = await supabase.from("expenses").select("id", { count: "exact", head: true }).eq("status", "submitted");
    counts["/approvals"] = count ?? 0;
  }

  const account = (
    <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-xs text-muted">{ROLE_LABELS[profile.role]}</p>
      </div>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text"
          aria-label="تسجيل الخروج"
          title="تسجيل الخروج"
        >
          <LogOut className="size-4" aria-hidden />
        </button>
      </form>
    </div>
  );

  const brand = (
    <div className="flex items-center gap-2">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-on-primary">
        <Truck className="size-4" aria-hidden />
      </span>
      <span className="font-bold">نظام النقل</span>
    </div>
  );

  return (
    <div className="lg:flex">
      {/* Desktop sidebar (on the right in RTL) */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-4 border-e border-border bg-surface p-4 lg:flex">
        {brand}
        <nav className="flex-1 overflow-y-auto" aria-label="القائمة الرئيسية">
          <NavLinks items={items} counts={counts} />
        </nav>
        {account}
      </aside>

      {/* Mobile top bar with a drop-down menu */}
      <header className="sticky top-0 z-20 border-b border-border bg-surface lg:hidden">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
            {brand}
            <span className="rounded-lg p-2 text-muted group-open:bg-surface-2" aria-label="القائمة">
              <Menu className="size-5" aria-hidden />
            </span>
          </summary>
          <div className="flex flex-col gap-3 border-t border-border px-4 pb-4 pt-2">
            <nav aria-label="القائمة الرئيسية">
              <NavLinks items={items} counts={counts} />
            </nav>
            {account}
          </div>
        </details>
      </header>

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
