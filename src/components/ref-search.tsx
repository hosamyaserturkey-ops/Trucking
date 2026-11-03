import { Search } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

/** Find a load by its reference number (رقم الإشارة) and open its customer's statement. */
export function RefSearch({ defaultValue = "", className = "" }: { defaultValue?: string; className?: string }) {
  return (
    <form action="/receivables/ref" role="search" className={`flex flex-wrap items-end gap-2 text-sm ${className}`}>
      <label className="flex flex-col gap-1 text-xs text-muted">
        رقم الإشارة أو مستند الزبون
        <input
          name="q"
          defaultValue={defaultValue}
          required
          placeholder="مثال: ARB-0041"
          className="w-56 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          dir="ltr"
          autoComplete="off"
        />
      </label>
      <button type="submit" className={buttonClass("secondary")}>
        <Search className="size-4" aria-hidden />
        كشف حساب النقلة
      </button>
    </form>
  );
}

/** Where a load's reference leads: the lookup, which opens its customer's statement at the load. */
export function refHref(ref: string): string {
  return `/receivables/ref?q=${encodeURIComponent(ref)}`;
}
