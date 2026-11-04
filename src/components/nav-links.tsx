"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  BookOpen,
  BookText,
  Building2,
  ChartColumn,
  CircleCheck,
  ClipboardList,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Flag,
  Fuel,
  HandCoins,
  History,
  Landmark,
  List,
  MapPin,
  Receipt,
  Route,
  Scale,
  Send,
  Settings,
  ShieldCheck,
  Stamp,
  Store,
  Truck,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
  Vault,
  ChevronDown,
} from "lucide-react";
import { NAV_GROUPS, type NavItem } from "@/lib/roles";

const ICONS: Record<string, LucideIcon> = {
  truck: Truck,
  route: Route,
  list: List,
  users: Users,
  building: Building2,
  store: Store,
  send: Send,
  flag: Flag,
  spreadsheet: FileSpreadsheet,
  landmark: Landmark,
  map: MapPin,
  book: BookOpen,
  shield: ShieldCheck,
  history: History,
  check: CircleCheck,
  clipboard: ClipboardList,
  wallet: Wallet,
  fuel: Fuel,
  receipt: Receipt,
  scale: Scale,
  journal: BookText,
  invoice: FileText,
  banknote: Banknote,
  handcoins: HandCoins,
  settings: Settings,
  stamp: Stamp,
  wrench: Wrench,
  chart: ChartColumn,
  bankcheck: FileCheck,
  vault: Vault,
};

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/trucks");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, active, count }: { item: NavItem; active: boolean; count?: number }) {
  const Icon = ICONS[item.icon] ?? List;
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        onClick={(e) => e.currentTarget.closest("details[data-menu]")?.removeAttribute("open")}
        // The current page is marked like a lane: a bar on its leading edge.
        className={`relative flex items-center gap-2.5 rounded-md py-1.5 ps-3 pe-2 text-sm transition-colors ${
          active
            ? "bg-primary-soft font-semibold text-primary before:absolute before:inset-y-1 before:start-0 before:w-[3px] before:rounded-full before:bg-primary"
            : "text-muted hover:bg-surface-2 hover:text-text"
        }`}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{item.label}</span>
        {count ? (
          <span className="num ms-auto rounded-full bg-hivis px-2 text-xs font-bold text-[#1d2b36]" aria-label={`${count} بانتظار`}>
            {count}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

/**
 * The menu in sections. Master data and admin stay folded unless the current
 * page is in them. `counts` adds a small badge to an item, e.g. expenses
 * waiting for approval.
 */
export function NavLinks({ items, counts = {} }: { items: NavItem[]; counts?: Record<string, number> }) {
  const pathname = usePathname();
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.group === g.key) })).filter((g) => g.items.length);
  // A driver has a single item: no sections.
  if (groups.length === 1 && groups[0].items.length < 3) {
    return (
      <ul className="flex flex-col gap-0.5">
        {groups[0].items.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} count={counts[item.href]} />
        ))}
      </ul>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => {
        const here = g.items.some((i) => isActive(pathname, i.href));
        const list = (
          <ul className="mt-1 flex flex-col gap-0.5">
            {g.items.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} count={counts[item.href]} />
            ))}
          </ul>
        );
        return g.folded ? (
          <details key={g.key} open={here} className="group/section">
            <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-3 py-1 text-xs font-medium text-muted hover:text-text [&::-webkit-details-marker]:hidden">
              {g.label}
              <ChevronDown className="size-3.5 transition-transform group-open/section:rotate-180" aria-hidden />
            </summary>
            {list}
          </details>
        ) : (
          <section key={g.key} aria-label={g.label}>
            <p className="px-3 text-xs font-medium text-muted">{g.label}</p>
            {list}
          </section>
        );
      })}
    </div>
  );
}
