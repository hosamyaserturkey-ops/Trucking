import { getProfile } from "@/lib/auth";
import type { AppRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { attachUpload, createUploadLink, deleteFile, discardUpload, StorageError, type FileKind } from "@/lib/storage";

// Who may upload or view which file. Every row lookup uses the signed-in
// user's own Supabase session, so row-level security decides what they see.

export type UploadPurpose = "expense_receipt" | "fuel_receipt" | "truck_document" | "customs_document";
export type ViewKind = "expense" | "fuel" | "truck-document" | "customs";

export const UPLOAD_PURPOSES: UploadPurpose[] = ["expense_receipt", "fuel_receipt", "truck_document", "customs_document"];
export const VIEW_KINDS: ViewKind[] = ["expense", "fuel", "truck-document", "customs"];

export const PURPOSE_KIND: Record<UploadPurpose, FileKind> = {
  expense_receipt: "receipts",
  fuel_receipt: "receipts",
  truck_document: "truck-documents",
  customs_document: "customs-documents",
};

// Same roles that may write the rows (RLS) and the old Supabase bucket policies.
const UPLOAD_ROLES: Record<UploadPurpose, AppRole[]> = {
  expense_receipt: ["driver", "manager", "accountant"],
  fuel_receipt: ["driver", "manager", "accountant", "dispatcher"],
  truck_document: ["manager", "dispatcher"],
  customs_document: ["manager", "accountant", "dispatcher"],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decideUpload(role: AppRole | null | undefined, purpose: UploadPurpose): boolean {
  return !!role && UPLOAD_ROLES[purpose].includes(role);
}

/** A reviewed or settled row keeps its file, like the row itself. */
export function canReplaceFile(row: { reviewed_at?: string | null; settlement_id?: string | null }): boolean {
  return !row.reviewed_at && !row.settlement_id;
}

/** Arabic message for a storage failure. */
export function storageErrorMessage(err: unknown): string {
  if (!(err instanceof StorageError)) return "تعذر الاتصال بخدمة الملفات، حاول لاحقاً";
  switch (err.code) {
    case "type":
      return "نوع الملف غير مسموح (المسموح: صور JPEG أو PNG أو WebP أو HEIC، أو PDF)";
    case "size":
      return "حجم الملف أكبر من الحد الأقصى 10 ميغابايت";
    case "path":
      return "ملف المرفق غير صالح";
    case "missing":
      return "لم يكتمل رفع الملف، حاول مرة أخرى";
    case "config":
      return "تخزين الملفات غير مُعدّ بعد؛ تواصل مع مدير النظام";
    default:
      return "تعذر الاتصال بخدمة الملفات، حاول لاحقاً";
  }
}

type RecordState = { driver_id?: string | null; reviewed_at?: string | null; settlement_id?: string | null };

async function loadRecord(purpose: UploadPurpose, id: string): Promise<RecordState | null> {
  const supabase = await createClient();
  if (purpose === "expense_receipt") {
    const { data } = await supabase.from("expenses").select("driver_id, reviewed_at, settlement_id").eq("id", id).maybeSingle();
    return data;
  }
  if (purpose === "fuel_receipt") {
    const { data } = await supabase.from("fuel_fillups").select("driver_id, reviewed_at, settlement_id").eq("id", id).maybeSingle();
    return data;
  }
  if (purpose === "customs_document") {
    const { data } = await supabase.from("customs_documents").select("id").eq("id", id).maybeSingle();
    return data ? {} : null;
  }
  const { data } = await supabase.from("truck_documents").select("id").eq("id", id).maybeSingle();
  return data ? {} : null;
}

export type UploadTicket = { ok: true; url: string; key: string; contentType: string } | { ok: false; error: string };

/**
 * Check the signed-in user may upload this file, then hand out a 5-minute
 * upload link for a server-chosen key in their own folder.
 */
export async function prepareUpload(input: {
  purpose: UploadPurpose;
  recordId?: string | null;
  contentType: string;
  size: number;
}): Promise<UploadTicket> {
  const profile = await getProfile();
  if (!profile?.role) return { ok: false, error: "سجّل الدخول أولاً" };
  if (!decideUpload(profile.role, input.purpose)) return { ok: false, error: "لا تملك صلاحية رفع هذا الملف" };

  if (input.recordId) {
    if (!UUID.test(input.recordId)) return { ok: false, error: "السجل غير صحيح" };
    const row = await loadRecord(input.purpose, input.recordId);
    if (!row) return { ok: false, error: "السجل غير موجود" };
    if (profile.role === "driver" && row.driver_id !== profile.driver_id) return { ok: false, error: "لا تملك صلاحية رفع هذا الملف" };
    if (!canReplaceFile(row)) return { ok: false, error: "تمت مراجعة هذا السجل ولا يمكن تغيير مرفقه" };
  }

  try {
    const link = await createUploadLink({
      kind: PURPOSE_KIND[input.purpose],
      userId: profile.user_id,
      contentType: input.contentType,
      size: input.size,
    });
    return { ok: true, ...link };
  } catch (err) {
    return { ok: false, error: storageErrorMessage(err) };
  }
}

/** The stored file of a row the signed-in user can see, or null (hidden by RLS, missing, or no file). */
export async function loadFileRow(kind: ViewKind, id: string): Promise<{ kind: FileKind; path: string } | null> {
  if (!UUID.test(id)) return null;
  const supabase = await createClient();
  if (kind === "expense") {
    const { data } = await supabase.from("expenses").select("receipt_path").eq("id", id).maybeSingle();
    return data?.receipt_path ? { kind: "receipts", path: data.receipt_path } : null;
  }
  if (kind === "fuel") {
    const { data } = await supabase.from("fuel_fillups").select("receipt_path").eq("id", id).maybeSingle();
    return data?.receipt_path ? { kind: "receipts", path: data.receipt_path } : null;
  }
  if (kind === "customs") {
    const { data } = await supabase.from("customs_documents").select("file_path").eq("id", id).maybeSingle();
    return data?.file_path ? { kind: "customs-documents", path: data.file_path } : null;
  }
  const { data } = await supabase.from("truck_documents").select("file_path").eq("id", id).maybeSingle();
  return data?.file_path ? { kind: "truck-documents", path: data.file_path } : null;
}

// ---------------------------------------------------------------------------
// Saving rows that carry a file
// ---------------------------------------------------------------------------

/** Check a fresh upload (owner, type, size) and move it into place before the row is saved. */
export async function attachFile(
  purpose: UploadPurpose,
  userId: string,
  uploadKey: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    return { ok: true, path: await attachUpload(PURPOSE_KIND[purpose], userId, uploadKey) };
  } catch (err) {
    return { ok: false, error: storageErrorMessage(err) };
  }
}

/**
 * After the row is saved: drop the upload's tmp copy and the file it replaced.
 * A failed clean-up never undoes the save; tmp copies also expire on their own.
 */
export async function afterFileSaved(purpose: UploadPurpose, uploadKey: string | null, replacedPath: string | null | undefined) {
  const results = await Promise.allSettled([
    uploadKey ? discardUpload(uploadKey) : Promise.resolve(),
    replacedPath ? deleteFile(PURPOSE_KIND[purpose], replacedPath) : Promise.resolve(),
  ]);
  for (const r of results) if (r.status === "rejected") console.error("file clean-up failed", r.reason);
}

/** Delete the file of a withdrawn row, or the copy made for a save that failed. */
export async function removeFile(purpose: UploadPurpose, path: string | null | undefined) {
  if (!path) return;
  await deleteFile(PURPOSE_KIND[purpose], path).catch((err) => console.error("file delete failed", err));
}
