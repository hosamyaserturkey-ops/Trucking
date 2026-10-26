// Shrink a receipt photo on the phone before upload: long side at most
// `maxSide` px, re-encoded as JPEG. Falls back to the original file when the
// browser cannot decode it (e.g. HEIC outside Safari).

export async function compressImage(file: File, maxSide = 1600, quality = 0.8): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/** Storage path for a driver's receipt: <user id>/<yyyy-mm>/<random>.<ext> */
export function receiptPath(userId: string, blob: Blob, now = new Date()): string {
  const month = now.toISOString().slice(0, 7);
  const ext = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/png" ? "png" : blob.type === "application/pdf" ? "pdf" : "img";
  return `${userId}/${month}/${crypto.randomUUID()}.${ext}`;
}
