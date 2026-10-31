"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  BookOpen,
  BookText,
  Building2,
  CircleCheck,
  ClipboardList,
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
} from "lucide-react";
import type { NavItem } from "@/lib/roles";

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
};

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/trucks");
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** `counts` adds a small badge to an item, e.g. expenses waiting for approval. */
export function NavLinks({ items, counts = {} }: { items: NavItem[]; counts?: Record<string, number> }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.icon] ?? List;
        const active = isActive(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2 hover:text-text"
              }`}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {item.label}
              {counts[item.href] ? (
                <span className="num ms-auto rounded-full bg-warning-soft px-2 text-xs font-semibold text-warning">
                  {counts[item.href]}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
