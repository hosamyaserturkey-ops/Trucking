// Display helpers. Latin digits throughout, as is usual in Jordanian accounting.

const intFormatter = new Intl.NumberFormat("en-US");

export function formatInt(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : intFormatter.format(Math.round(value));
}

export function formatDecimal(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 2026-10-25 -> 25/10/2026 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Amman",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Timestamp shown in the company's timezone. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return dateTimeFormatter.format(new Date(iso)).replace(",", "");
}

const MONTHS_AR = [
  "كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران",
  "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول",
];

/** 2026-05-01 -> "أيار 2026" (Levantine month names). */
export function formatMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS_AR[m - 1]} ${y}`;
}

export function formatMonthShort(iso: string): string {
  const [, m] = iso.split("-").map(Number);
  return MONTHS_AR[m - 1];
}
