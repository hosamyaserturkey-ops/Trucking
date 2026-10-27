import { formatMoney } from "@/lib/money";
import { balanceSide, type StatementFilter } from "@/lib/ledger";
import { buttonClass } from "@/components/ui/button";

type Option = { id: string; label: string };

/** A debit or credit amount; empty when zero, so each line shows one side. */
export function Amount({ minor }: { minor: number }) {
  return minor ? <>{formatMoney(minor, "JOD", { withCurrency: false })}</> : null;
}

/** A balance with its side (مدين / دائن). */
export function Balance({ minor }: { minor: number }) {
  const b = balanceSide(minor);
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="num">{formatMoney(b.minor, "JOD", { withCurrency: false })}</span>
      {b.side ? <span className="text-xs font-normal text-muted">{b.side}</span> : null}
    </span>
  );
}

const FIELD = "rounded-lg border border-border bg-surface px-3 py-2 text-sm";

/** Period and party filters for a statement, as a plain GET form. */
export function StatementFilters({
  action,
  filter,
  trucks,
  suppliers,
  drivers,
}: {
  action: string;
  filter: StatementFilter;
  trucks?: Option[];
  suppliers?: Option[];
  drivers?: Option[];
}) {
  const select = (name: "truck" | "supplier" | "driver", label: string, options?: Option[]) =>
    options ? (
      <label className="flex flex-col gap-1 text-xs text-muted">
        {label}
        <select name={name} defaultValue={filter[name]} className={FIELD}>
          <option value="">الكل</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    ) : null;
  return (
    <form action={action} className="mb-4 flex flex-wrap items-end gap-2 text-sm">
      <label className="flex flex-col gap-1 text-xs text-muted">
        من
        <input type="date" name="from" defaultValue={filter.from} className={FIELD} dir="ltr" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        إلى
        <input type="date" name="to" defaultValue={filter.to} className={FIELD} dir="ltr" />
      </label>
      {select("truck", "الشاحنة", trucks)}
      {select("supplier", "المورد", suppliers)}
      {select("driver", "السائق", drivers)}
      <button type="submit" className={buttonClass("secondary")}>
        عرض
      </button>
    </form>
  );
}
