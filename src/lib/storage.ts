import "server-only";
import { AwsClient, AwsV4Signer } from "aws4fetch";

// All file storage goes through this module: a private Cloudflare R2 bucket
// reached with R2's S3-compatible API. Only this file holds the R2 keys or
// signs requests. Browsers get short-lived signed links and nothing else.
//
// Layout (the database stores only the relative path <uid>/<yyyy-mm>/<uuid>.<ext>):
//   receipts/<path>              expense and diesel receipts
//   truck-documents/<path>       truck document scans
//   customs-documents/<path>     customs declarations (البيان الجمركي)
//   tmp/<kind>/<path>            fresh uploads; moved out on save, otherwise
//                                removed by the bucket's 1-day lifecycle rule
//
// Kept free of "@/..." imports and of TypeScript-only syntax, so one-off
// scripts can import it with Node's built-in type stripping.

export type FileKind = "receipts" | "truck-documents" | "customs-documents";

export const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};
export const MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TTL_SECONDS = 300;
export const VIEW_TTL_SECONDS = 600;
export const VIEW_TTL_MAX_SECONDS = 1800;

const KINDS: FileKind[] = ["receipts", "truck-documents", "customs-documents"];
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH = new RegExp(`^(${UUID})/(\\d{4}-(?:0[1-9]|1[0-2]))/(${UUID})\\.(jpg|png|webp|heic|pdf)$`);

export type StorageErrorCode = "config" | "type" | "size" | "path" | "missing" | "upstream";

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "StorageError";
  }
}

type Config = { accessKeyId: string; secretAccessKey: string; bucket: string; endpoint: string };

/** Read the R2 settings. Server-only variables; never NEXT_PUBLIC_. */
export function storageConfig(env: Record<string, string | undefined> = process.env): Config {
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim() ?? "";
  const bucket = env.R2_BUCKET?.trim() ?? "";
  const accountId = env.R2_ACCOUNT_ID?.trim() ?? "";
  const endpoint = (env.R2_ENDPOINT?.trim() || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "")).replace(/\/+$/, "");
  if (!accessKeyId || !secretAccessKey || !bucket || !endpoint) {
    throw new StorageError("config", "R2 is not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)");
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new StorageError("config", "R2_BUCKET is not a valid bucket name");
  if (!/^https?:\/\/[^/]+$/.test(endpoint)) throw new StorageError("config", "R2 endpoint must be an origin like https://<account>.r2.cloudflarestorage.com");
  return { accessKeyId, secretAccessKey, bucket, endpoint };
}

export function isStorageConfigured(): boolean {
  try {
    storageConfig();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Paths and keys (pure)
// ---------------------------------------------------------------------------

/** Parse a stored relative path; null unless it is exactly <uid>/<yyyy-mm>/<uuid>.<ext>. */
export function parsePath(path: string): { userId: string; month: string; ext: string } | null {
  const m = PATH.exec(path);
  return m ? { userId: m[1], month: m[2], ext: m[4] } : null;
}

export function objectKey(kind: FileKind, path: string): string {
  if (!KINDS.includes(kind) || !parsePath(path)) throw new StorageError("path", "Invalid file path");
  return `${kind}/${path}`;
}

export function tmpKey(kind: FileKind, path: string): string {
  return `tmp/${objectKey(kind, path)}`;
}

/**
 * The relative path inside an upload key, if the key is a fresh upload of this
 * kind in this user's own folder. Anything else (another user, another kind,
 * a final key, odd characters) gives null.
 */
export function ownedUploadPath(key: string, kind: FileKind, userId: string): string | null {
  const prefix = `tmp/${kind}/`;
  if (!key.startsWith(prefix)) return null;
  const path = key.slice(prefix.length);
  const parsed = parsePath(path);
  return parsed && parsed.userId === userId.toLowerCase() ? path : null;
}

/** Validate an upload request; returns the file extension for the type. */
export function checkUpload(contentType: string, size: number): string {
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) throw new StorageError("type", `File type not allowed: ${contentType || "unknown"}`);
  if (!Number.isSafeInteger(size) || size <= 0) throw new StorageError("size", "Empty or invalid file size");
  if (size > MAX_BYTES) throw new StorageError("size", "File is larger than 10 MB");
  return ext;
}

/** A new server-chosen path: <uid>/<yyyy-mm>/<random uuid>.<ext> */
export function newPath(userId: string, ext: string, now: Date = new Date()): string {
  const path = `${userId.toLowerCase()}/${now.toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  if (!parsePath(path)) throw new StorageError("path", "Invalid user id");
  return path;
}

// ---------------------------------------------------------------------------
// Signed links
// ---------------------------------------------------------------------------

function objectUrl(cfg: Config, key: string): URL {
  // Keys only contain [0-9a-z-./], so no escaping is needed.
  return new URL(`${cfg.endpoint}/${cfg.bucket}/${key}`);
}

async function presign(cfg: Config, method: "GET" | "PUT", key: string, ttl: number, headers: Record<string, string> = {}, now?: Date) {
  const url = objectUrl(cfg, key);
  url.searchParams.set("X-Amz-Expires", String(ttl));
  const signer = new AwsV4Signer({
    method,
    url: url.toString(),
    headers,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: "s3",
    region: "auto",
    signQuery: true,
    // Sign content-type and content-length too, so the link only accepts this exact file.
    allHeaders: true,
    datetime: now ? now.toISOString().replace(/[:-]|\.\d{3}/g, "") : undefined,
  });
  return (await signer.sign()).url.toString();
}

/**
 * A presigned PUT for a new upload. The server picks the key; the link expires
 * after 5 minutes and only accepts this content type and exact byte size.
 */
export async function createUploadLink(input: {
  kind: FileKind;
  userId: string;
  contentType: string;
  size: number;
  ttlSeconds?: number;
  now?: Date;
}): Promise<{ url: string; key: string; contentType: string }> {
  const cfg = storageConfig();
  const ext = checkUpload(input.contentType, input.size);
  const key = tmpKey(input.kind, newPath(input.userId, ext, input.now));
  const ttl = Math.min(Math.max(1, Math.floor(input.ttlSeconds ?? UPLOAD_TTL_SECONDS)), UPLOAD_TTL_SECONDS);
  const url = await presign(cfg, "PUT", key, ttl, { "content-type": input.contentType, "content-length": String(input.size) }, input.now);
  return { url, key, contentType: input.contentType };
}

/** A presigned GET for viewing a stored file, valid for at most 30 minutes. */
export async function createViewLink(kind: FileKind, path: string, ttlSeconds = VIEW_TTL_SECONDS, now?: Date): Promise<string> {
  const cfg = storageConfig();
  const ttl = Math.min(Math.max(1, Math.floor(ttlSeconds)), VIEW_TTL_MAX_SECONDS);
  return presign(cfg, "GET", objectKey(kind, path), ttl, {}, now);
}

// ---------------------------------------------------------------------------
// Server-side object operations
// ---------------------------------------------------------------------------

function client(cfg: Config) {
  return new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: "s3", region: "auto", retries: 2 });
}

async function call(method: string, key: string, headers: Record<string, string> = {}, body?: BodyInit) {
  const cfg = storageConfig();
  try {
    return await client(cfg).fetch(objectUrl(cfg, key).toString(), { method, headers, body });
  } catch (err) {
    throw new StorageError("upstream", `Storage request failed: ${(err as Error).message}`);
  }
}

/** Whether an object exists, with its stored type and size. */
export async function checkFile(key: string): Promise<{ exists: boolean; contentType: string | null; size: number | null }> {
  const res = await call("HEAD", key);
  if (res.status === 404) return { exists: false, contentType: null, size: null };
  if (!res.ok) throw new StorageError("upstream", `HEAD failed with ${res.status}`);
  const length = res.headers.get("content-length");
  return { exists: true, contentType: res.headers.get("content-type"), size: length === null ? null : Number(length) };
}

/**
 * Move a fresh upload into place before its row is saved. Checks that the key
 * is in this user's folder for this kind and that the stored object really has
 * an allowed type (matching its extension) and size. Returns the relative path
 * to store in the database. Call discardUpload() after the row is saved.
 */
export async function attachUpload(kind: FileKind, userId: string, uploadKey: string): Promise<string> {
  const path = ownedUploadPath(uploadKey, kind, userId);
  if (!path) throw new StorageError("path", "Upload is not in this user's folder");
  const info = await checkFile(uploadKey);
  if (!info.exists) throw new StorageError("missing", "Upload not found");
  const ext = parsePath(path)!.ext;
  const typeOk = info.contentType !== null && ALLOWED_TYPES[info.contentType.split(";")[0].trim()] === ext;
  const sizeOk = info.size !== null && info.size > 0 && info.size <= MAX_BYTES;
  if (!typeOk || !sizeOk) {
    await discardUpload(uploadKey).catch(() => {});
    throw new StorageError(typeOk ? "size" : "type", "Uploaded file does not match the allowed type or size");
  }
  const cfg = storageConfig();
  const res = await call("PUT", objectKey(kind, path), { "x-amz-copy-source": `/${cfg.bucket}/${uploadKey}` });
  const text = res.ok ? await res.text() : "";
  // S3 can answer 200 with an error document for a failed copy.
  if (!res.ok || text.includes("<Error>")) throw new StorageError("upstream", `Copy failed with ${res.status}`);
  return path;
}

/** Remove a fresh upload (after its copy was saved, or when abandoning it). */
export async function discardUpload(uploadKey: string): Promise<void> {
  if (!/^tmp\/(receipts|truck-documents|customs-documents)\//.test(uploadKey) || uploadKey.includes("..")) {
    throw new StorageError("path", "Not an upload key");
  }
  const res = await call("DELETE", uploadKey);
  if (!res.ok && res.status !== 404) throw new StorageError("upstream", `DELETE failed with ${res.status}`);
}

/** Delete a stored file (a replaced or withdrawn receipt). */
export async function deleteFile(kind: FileKind, path: string): Promise<void> {
  const res = await call("DELETE", objectKey(kind, path));
  if (!res.ok && res.status !== 404) throw new StorageError("upstream", `DELETE failed with ${res.status}`);
}

/** Server-side write of a stored file (used by the one-off copy from Supabase). */
export async function putFile(kind: FileKind, path: string, body: ArrayBuffer, contentType: string): Promise<void> {
  checkUpload(contentType, body.byteLength);
  const res = await call("PUT", objectKey(kind, path), { "content-type": contentType }, body);
  if (!res.ok) throw new StorageError("upstream", `PUT failed with ${res.status}`);
}

/** Local test servers only (MinIO): create the bucket. Refuses to touch real R2. */
export async function createBucketIfMissing(): Promise<void> {
  const cfg = storageConfig();
  if (/r2\.cloudflarestorage\.com$/.test(new URL(cfg.endpoint).hostname)) {
    throw new StorageError("config", "Create the R2 bucket in the Cloudflare dashboard");
  }
  const res = await client(cfg).fetch(`${cfg.endpoint}/${cfg.bucket}`, { method: "PUT" });
  if (!res.ok && res.status !== 409) throw new StorageError("upstream", `Create bucket failed with ${res.status}`);
}
