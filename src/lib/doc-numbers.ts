// Numbers of the paper documents behind a payment: the payment voucher (سند صرف)
// from the voucher book, the bank notice (إشعار), the customs declaration
// (البيان الجمركي). Typed by hand; trimmed, Arabic digits made Latin.

export const DOC_FIELDS = {
  voucher_no: { label: "رقم سند الصرف", max: 30 },
  notice_no: { label: "رقم الإشعار", max: 40 },
  customs_declaration_no: { label: "رقم البيان الجمركي", max: 40 },
} as const;

export type DocField = keyof typeof DOC_FIELDS;

/** Read the given document numbers from a form: null when left empty. */
export function parseDocNumbers<F extends DocField>(
  text: (name: string) => string,
  fields: readonly F[],
): { ok: true; values: Record<F, string | null> } | { ok: false; error: string } {
  const values = {} as Record<F, string | null>;
  for (const f of fields) {
    const v = text(f).replace(/\s+/g, " ").trim();
    if (v.length > DOC_FIELDS[f].max) return { ok: false, error: `${DOC_FIELDS[f].label} طويل جداً` };
    values[f] = v || null;
  }
  return { ok: true, values };
}
