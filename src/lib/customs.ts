import { toLatinDigits } from "@/lib/money";

// Customs declarations (البيان الجمركي) kept on file. The broker's account on
// the customs inquiry system is never stored here: staff open the system in
// their own browser and attach the declaration they print or save.

type Get = (name: string) => string | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type CustomsDocumentValues = {
  declaration_no: string;
  declaration_date: string | null;
  trip_id: string | null;
  notes: string | null;
  receipt_upload: string;
};

/** A declaration to file: its number, optional date and load, and the uploaded file. */
export function parseCustomsDocument(
  get: Get,
  opts: { userId: string; today: string },
): { ok: true; values: CustomsDocumentValues } | { ok: false; error: string } {
  const text = (name: string) => toLatinDigits((get(name) ?? "").trim());
  const declaration_no = text("declaration_no").replace(/\s+/g, " ");
  if (!declaration_no) return { ok: false, error: "أدخل رقم البيان الجمركي" };
  if (declaration_no.length > 40) return { ok: false, error: "رقم البيان طويل جداً" };
  const date = text("declaration_date");
  if (date && (!ISO_DATE.test(date) || date > opts.today)) return { ok: false, error: "تاريخ البيان غير صحيح" };
  const trip = text("trip_id");
  if (trip && !UUID.test(trip)) return { ok: false, error: "النقلة غير صحيحة" };
  const notes = (get("notes") ?? "").trim();
  if (notes.length > 500) return { ok: false, error: "الملاحظات طويلة جداً" };
  const upload = text("receipt_upload");
  if (!upload) return { ok: false, error: "أرفق ملف البيان (PDF أو صورة)" };
  if (!upload.startsWith(`tmp/customs-documents/${opts.userId}/`) || upload.includes("..")) return { ok: false, error: "ملف البيان غير صالح" };
  return {
    ok: true,
    values: { declaration_no, declaration_date: date || null, trip_id: trip || null, notes: notes || null, receipt_upload: upload },
  };
}

/** The customs inquiry system's address, if it is a plain https link. */
export function parsePortalUrl(raw: string): string | null {
  const v = raw.trim();
  if (!/^https:\/\/[^\s]+$/.test(v)) return null;
  try {
    return new URL(v).protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}
