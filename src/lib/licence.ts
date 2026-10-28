import { toLatinDigits } from "@/lib/money";

// Licences attached on the driver and truck forms: the driving licence scan
// (رخصة القيادة) and the truck licence (رخصة المركبة: number, expiry, scan).

type Get = (name: string) => string | null;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The licence scan uploaded with the form, if any: it must be the user's own fresh upload. */
export function licenceUpload(
  get: Get,
  kind: "driver-documents" | "truck-documents",
  userId: string,
): { ok: true; key: string | null } | { ok: false; error: string } {
  const key = (get("receipt_upload") ?? "").trim();
  if (!key) return { ok: true, key: null };
  if (!key.startsWith(`tmp/${kind}/${userId}/`) || key.includes("..")) return { ok: false, error: "ملف الرخصة غير صالح" };
  return { ok: true, key };
}

export type TruckLicence = { doc_number: string | null; expiry_date: string | null };

/** The truck licence number and expiry from the truck form; null when both are left empty. */
export function parseTruckLicence(get: Get): { ok: true; values: TruckLicence | null } | { ok: false; error: string } {
  const doc_number = toLatinDigits((get("licence_number") ?? "").trim()).replace(/\s+/g, " ");
  if (doc_number.length > 40) return { ok: false, error: "رقم رخصة الشاحنة طويل جداً" };
  const expiry_date = toLatinDigits((get("licence_expiry") ?? "").trim());
  if (expiry_date && !ISO_DATE.test(expiry_date)) return { ok: false, error: "تاريخ انتهاء رخصة الشاحنة غير صحيح" };
  if (!doc_number && !expiry_date) return { ok: true, values: null };
  return { ok: true, values: { doc_number: doc_number || null, expiry_date: expiry_date || null } };
}
