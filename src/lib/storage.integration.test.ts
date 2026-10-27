import { beforeAll, describe, expect, it } from "vitest";
import {
  attachUpload,
  checkFile,
  createBucketIfMissing,
  createUploadLink,
  createViewLink,
  deleteFile,
  discardUpload,
  objectKey,
  storageConfig,
} from "./storage";

// Runs against a real S3-compatible server: `pnpm test:storage` with the R2_*
// variables set (Cloudflare R2, or a local MinIO via R2_ENDPOINT). Skipped otherwise.
const enabled = process.env.STORAGE_IT === "1";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function bytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(n));
  for (let i = 0; i < n; i++) out[i] = i % 251;
  return out;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function upload(contentType: string, body: Uint8Array<ArrayBuffer>, userId = USER, ttlSeconds?: number) {
  const link = await createUploadLink({ kind: "receipts", userId, contentType, size: body.byteLength, ttlSeconds });
  const res = await fetch(link.url, { method: "PUT", headers: { "content-type": contentType }, body });
  return { link, res };
}

// Real R2 is a few hundred ms per request, so the default 5 s is too tight.
describe.skipIf(!enabled)("storage against a live S3-compatible server", { timeout: 20_000 }, () => {
  beforeAll(async () => {
    if (!/r2\.cloudflarestorage\.com$/.test(new URL(storageConfig().endpoint).hostname)) await createBucketIfMissing();
  });

  it("uploads with a signed link, checks, attaches, views and deletes", async () => {
    const body = bytes(2048);
    const { link, res } = await upload("image/jpeg", body);
    expect(res.status).toBe(200);
    expect(await checkFile(link.key)).toEqual({ exists: true, contentType: "image/jpeg", size: 2048 });

    const path = await attachUpload("receipts", USER, link.key);
    await discardUpload(link.key);
    expect((await checkFile(link.key)).exists).toBe(false);
    expect((await checkFile(objectKey("receipts", path))).exists).toBe(true);

    const view = await fetch(await createViewLink("receipts", path));
    expect(view.status).toBe(200);
    expect(new Uint8Array(await view.arrayBuffer())).toEqual(body);

    await deleteFile("receipts", path);
    expect((await checkFile(objectKey("receipts", path))).exists).toBe(false);
  });

  it("refuses a different content type than the link was signed for", async () => {
    const link = await createUploadLink({ kind: "receipts", userId: USER, contentType: "image/jpeg", size: 100 });
    const res = await fetch(link.url, { method: "PUT", headers: { "content-type": "application/pdf" }, body: bytes(100) });
    expect(res.status).toBe(403);
    expect((await checkFile(link.key)).exists).toBe(false);
  });

  it("refuses a larger or smaller file than the link was signed for", async () => {
    const link = await createUploadLink({ kind: "receipts", userId: USER, contentType: "image/png", size: 100 });
    for (const n of [101, 5000, 99]) {
      const res = await fetch(link.url, { method: "PUT", headers: { "content-type": "image/png" }, body: bytes(n) });
      expect(res.status, `${n} bytes`).toBe(403);
    }
    expect((await checkFile(link.key)).exists).toBe(false);
  });

  it("refuses an upload link after it expires", async () => {
    const link = await createUploadLink({ kind: "receipts", userId: USER, contentType: "image/jpeg", size: 10, ttlSeconds: 1 });
    await sleep(2500);
    const res = await fetch(link.url, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: bytes(10) });
    expect(res.status).toBe(403);
  });

  it("refuses an upload link used for another key", async () => {
    const link = await createUploadLink({ kind: "receipts", userId: USER, contentType: "image/jpeg", size: 10 });
    const moved = link.url.replace(`/tmp/receipts/${USER}/`, `/tmp/receipts/${OTHER}/`);
    const res = await fetch(moved, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: bytes(10) });
    expect(res.status).toBe(403);
  });

  it("view links stop working after they expire", async () => {
    const { link } = await upload("image/webp", bytes(64));
    const path = await attachUpload("receipts", USER, link.key);
    const url = await createViewLink("receipts", path, 1);
    expect((await fetch(url)).status).toBe(200);
    await sleep(2500);
    expect((await fetch(url)).status).toBe(403);
    await deleteFile("receipts", path);
    await discardUpload(link.key);
  });

  it("will not attach someone else's upload, another kind, or a missing file", async () => {
    const { link } = await upload("application/pdf", bytes(300), OTHER);
    await expect(attachUpload("receipts", USER, link.key)).rejects.toMatchObject({ code: "path" });
    await expect(attachUpload("truck-documents", OTHER, link.key)).rejects.toMatchObject({ code: "path" });
    await discardUpload(link.key);
    await expect(attachUpload("receipts", OTHER, link.key)).rejects.toMatchObject({ code: "missing" });
  });
});
