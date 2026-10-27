"use server";

import { prepareUpload, UPLOAD_PURPOSES, type UploadPurpose, type UploadTicket } from "@/lib/file-access";

/** Browser asks for a signed upload link; the server checks role, record and file, and picks the key. */
export async function requestUpload(input: {
  purpose: UploadPurpose;
  recordId?: string | null;
  contentType: string;
  size: number;
}): Promise<UploadTicket> {
  // Values from the browser are untrusted: check their shape before anything else.
  if (!input || !UPLOAD_PURPOSES.includes(input.purpose)) return { ok: false, error: "طلب رفع غير صحيح" };
  if (typeof input.contentType !== "string" || typeof input.size !== "number") return { ok: false, error: "طلب رفع غير صحيح" };
  const recordId = typeof input.recordId === "string" && input.recordId ? input.recordId : null;
  return prepareUpload({ purpose: input.purpose, recordId, contentType: input.contentType, size: input.size });
}
