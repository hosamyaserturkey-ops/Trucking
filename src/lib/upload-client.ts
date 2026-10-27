import { requestUpload } from "@/app/files/actions";
import type { UploadPurpose } from "@/lib/file-access";
import { compressImage } from "@/lib/image";

// Browser side of an upload: shrink photos, ask the server for a signed link,
// then PUT the file straight to storage. No keys here; the link only accepts
// this exact file type and size and expires after 5 minutes.

const BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heic",
  pdf: "application/pdf",
};

/** Content type to declare, falling back to the extension when the browser gives none (e.g. HEIC). */
export function fileType(blob: Blob, name: string): string {
  if (blob.type === "image/heif") return "image/heic";
  if (blob.type) return blob.type;
  return BY_EXTENSION[name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
}

export async function uploadFile(
  file: File,
  purpose: UploadPurpose,
  recordId?: string | null,
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const blob = await compressImage(file);
  const contentType = fileType(blob, file.name);
  const ticket = await requestUpload({ purpose, recordId, contentType, size: blob.size });
  if (!ticket.ok) return ticket;
  try {
    const res = await fetch(ticket.url, { method: "PUT", headers: { "content-type": ticket.contentType }, body: blob });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    return { ok: false, error: "تعذر رفع الملف. تحقق من الاتصال وحاول مرة أخرى." };
  }
  return { ok: true, key: ticket.key };
}
