// Date filter for Truck 360: ?range=month|year|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
// Ranges are half-open [from, to) so they compose with SQL `>= from and < to`.

export type RangeKey = "month" | "year" | "custom";

export type DateRange = {
  key: RangeKey;
  from: string; // inclusive
  to: string; // exclusive
  label: string;
};

export const TIMEZONE = "Asia/Amman";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in the company's timezone, as YYYY-MM-DD. */
export function todayIso(now: Date = new Date(), timeZone = TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** Whole days from one date to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86400000);
}

/** How close an expiry date is, in the bands the alerts use (as document_expiry_v). */
export function expiryBand(daysLeft: number | null): "expired" | "d7" | "d30" | "d60" | "ok" | "none" {
  if (daysLeft === null) return "none";
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 7) return "d7";
  if (daysLeft <= 30) return "d30";
  if (daysLeft <= 60) return "d60";
  return "ok";
}

function isValidIso(value: string | undefined): value is string {
  if (!value || !ISO_DATE.test(value)) return false;
  return toIso(toDate(value)) === value;
}

export function resolveRange(
  params: { range?: string; from?: string; to?: string },
  today: string = todayIso(),
): DateRange {
  const [y, m] = today.split("-").map(Number);

  if (params.range === "custom" && isValidIso(params.from) && isValidIso(params.to)) {
    let from = params.from;
    let toInclusive = params.to;
    if (from > toInclusive) [from, toInclusive] = [toInclusive, from];
    return { key: "custom", from, to: addDays(toInclusive, 1), label: `${from} ← ${toInclusive}` };
  }

  if (params.range === "month") {
    const from = `${y}-${String(m).padStart(2, "0")}-01`;
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    return { key: "month", from, to: next, label: "هذا الشهر" };
  }

  // Default: this year.
  return { key: "year", from: `${y}-01-01`, to: `${y + 1}-01-01`, label: "هذه السنة" };
}

/** Inclusive end date for display and date inputs. */
export function inclusiveEnd(range: DateRange): string {
  return addDays(range.to, -1);
}

/** First day of each month that overlaps the range, oldest first. */
export function monthsIn(range: DateRange): string[] {
  const months: string[] = [];
  let cursor = `${range.from.slice(0, 7)}-01`;
  while (cursor < range.to) {
    months.push(cursor);
    const [y, m] = cursor.split("-").map(Number);
    cursor = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  }
  return months;
}
