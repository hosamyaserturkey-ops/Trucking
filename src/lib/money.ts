// Money is stored as integer minor units (JOD fils = 3 decimals, USD cents = 2).
// Everything here works on integers and strings, never on floating point.

export const MINOR_UNITS: Record<string, number> = { JOD: 3, USD: 2 };
export const CURRENCY_LABELS: Record<string, string> = { JOD: "د.أ", USD: "$" };

export function minorUnits(currency: string): number {
  const units = MINOR_UNITS[currency];
  if (units === undefined) throw new Error(`Unknown currency: ${currency}`);
  return units;
}

const groupFormatter = new Intl.NumberFormat("en-US", { useGrouping: true });

type FormatOptions = {
  /** Show fewer decimals than the currency has (rounded half away from zero). */
  fractionDigits?: number;
  /** Append the currency label (default true). */
  withCurrency?: boolean;
};

export function formatMoney(
  minor: number | bigint | null | undefined,
  currency = "JOD",
  { fractionDigits, withCurrency = true }: FormatOptions = {},
): string {
  if (minor === null || minor === undefined) return "—";
  const units = minorUnits(currency);
  const digits = Math.min(fractionDigits ?? units, units);
  let value = BigInt(minor);
  const negative = value < 0n;
  if (negative) value = -value;

  // Drop extra decimals with half-up rounding on the absolute value.
  const drop = BigInt(10 ** (units - digits));
  if (drop > 1n) value = (value + drop / 2n) / drop;

  const scale = BigInt(10 ** digits);
  const whole = value / scale;
  const frac = value % scale;
  let text = groupFormatter.format(whole);
  if (digits > 0) text += "." + frac.toString().padStart(digits, "0");
  if (negative && value !== 0n) text = "-" + text;
  return withCurrency ? `${text} ${CURRENCY_LABELS[currency] ?? currency}` : text;
}

const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/**
 * Parse user input like "1,234.5" or "١٢٣٤٫٥" into minor units.
 * Returns null for anything that is not a plain amount or has too many decimals.
 */
export function parseMoney(input: string, currency = "JOD"): bigint | null {
  const units = minorUnits(currency);
  const normalized = input
    .trim()
    .replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGITS[d])
    .replace(/٫/g, ".")
    .replace(/[,٬\s]/g, "");
  const match = /^(-)?(\d+)(?:\.(\d*))?$/.exec(normalized);
  if (!match) return null;
  const [, sign, whole, frac = ""] = match;
  if (frac.length > units) return null;
  const value = BigInt(whole) * BigInt(10 ** units) + BigInt(frac.padEnd(units, "0") || "0");
  return sign ? -value : value;
}

/** Sum integer minor amounts, ignoring nulls. Throws if a value is not an integer. */
export function sumMinor(values: Iterable<number | null | undefined>): number {
  let total = 0;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (!Number.isSafeInteger(v)) throw new Error(`Not an integer minor amount: ${v}`);
    total += v;
  }
  if (!Number.isSafeInteger(total)) throw new Error("Money total exceeds safe integer range");
  return total;
}
