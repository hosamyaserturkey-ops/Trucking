import type { ReactNode } from "react";
import { LogOut, Menu, Truck } from "lucide-react";
import type { NavItem } from "@/lib/roles";
import { NavLinks } from "@/components/nav-links";

/**
 * The frame around every staff and driver page: the sectioned menu in a
 * sidebar on the right (RTL) on wide screens, a top bar with a drop-down menu
 * on phones, and the signed-in person with a sign-out button.
 */
export function AppShell({
  items,
  counts,
  name,
  roleLabel,
  signOut,
  children,
}: {
  items: NavItem[];
  counts: Record<string, number>;
  name: string;
  roleLabel: string;
  signOut: () => Promise<void>;
  children: ReactNode;
}) {
  const account = (
    <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-xs text-muted">{roleLabel}</p>
      </div>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-text"
          aria-label="تسجيل الخروج"
          title="تسجيل الخروج"
        >
          <LogOut className="size-4" aria-hidden />
        </button>
      </form>
    </div>
  );

  const brand = (
    <div className="flex items-center gap-2.5">
      <span className="flex size-9 items-center justify-center rounded-md bg-primary text-on-primary">
        <Truck className="size-5" aria-hidden />
      </span>
      <span className="font-display text-lg font-bold">نظام النقل</span>
    </div>
  );

  return (
    <div className="lg:flex">
      {/* Desktop sidebar (on the right in RTL) */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-5 border-e border-border bg-surface px-3 py-4 lg:flex">
        <div className="px-2">{brand}</div>
        <nav className="-mx-1 flex-1 overflow-y-auto px-1" aria-label="القائمة الرئيسية">
          <NavLinks items={items} counts={counts} />
        </nav>
        <div className="px-2">{account}</div>
      </aside>

      {/* Phone top bar with a drop-down menu */}
      <header className="sticky top-0 z-20 border-b border-border bg-surface lg:hidden">
        <details data-menu className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 [&::-webkit-details-marker]:hidden">
            {brand}
            <span className="rounded-md p-2 text-muted group-open:bg-surface-2" aria-label="القائمة">
              <Menu className="size-5" aria-hidden />
            </span>
          </summary>
          <div className="flex max-h-[75dvh] flex-col gap-3 overflow-y-auto border-t border-border px-3 pb-4 pt-3">
            <nav aria-label="القائمة الرئيسية">
              <NavLinks items={items} counts={counts} />
            </nav>
            {account}
          </div>
        </details>
      </header>

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">{children}</main>
    </div>
  );
}
