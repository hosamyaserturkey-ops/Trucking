import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkUpload,
  createUploadLink,
  createViewLink,
  MAX_BYTES,
  newPath,
  objectKey,
  ownedUploadPath,
  parsePath,
  storageConfig,
  StorageError,
  tmpKey,
} from "./storage";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FILE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PATH = `${USER}/2026-10/${FILE}.jpg`;
const ENV = {
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_ACCESS_KEY_ID: "test-key",
  R2_SECRET_ACCESS_KEY: "test-secret",
  R2_BUCKET: "trucking-files",
};

let saved: NodeJS.ProcessEnv;
beforeEach(() => {
  saved = { ...process.env };
  delete process.env.R2_ENDPOINT;
  Object.assign(process.env, ENV);
});
afterEach(() => {
  process.env = saved;
});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof StorageError ? err.code : "other";
  }
  return null;
};

describe("config", () => {
  it("builds the R2 endpoint from the account id", () => {
    expect(storageConfig(ENV).endpoint).toBe("https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com");
  });
  it("uses an endpoint override (local MinIO)", () => {
    expect(storageConfig({ ...ENV, R2_ENDPOINT: "http://127.0.0.1:9000/" }).endpoint).toBe("http://127.0.0.1:9000");
  });
  it("fails clearly when keys or bucket are missing or odd", () => {
    expect(code(() => storageConfig({ ...ENV, R2_SECRET_ACCESS_KEY: "" }))).toBe("config");
    expect(code(() => storageConfig({ ...ENV, R2_ACCOUNT_ID: "" }))).toBe("config");
    expect(code(() => storageConfig({ ...ENV, R2_BUCKET: "Bad_Bucket" }))).toBe("config");
  });
});

describe("paths and keys", () => {
  it("accepts only <uid>/<yyyy-mm>/<uuid>.<ext>", () => {
    expect(parsePath(PATH)).toEqual({ userId: USER, month: "2026-10", ext: "jpg" });
    for (const bad of [
      `../${PATH}`,
      `/${PATH}`,
      `${USER}/2026-10/../${FILE}.jpg`,
      `${USER}/2026-13/${FILE}.jpg`,
      `${USER}/2026-10/${FILE}.exe`,
      `${USER}/2026-10/${FILE}.jpg/x`,
      `${USER.toUpperCase()}/2026-10/${FILE}.jpg`,
      `not-a-user/2026-10/${FILE}.jpg`,
    ]) {
      expect(parsePath(bad), bad).toBeNull();
    }
  });
  it("prefixes keys by kind and refuses invalid paths", () => {
    expect(objectKey("receipts", PATH)).toBe(`receipts/${PATH}`);
    expect(objectKey("customs-documents", PATH)).toBe(`customs-documents/${PATH}`);
    expect(objectKey("driver-documents", PATH)).toBe(`driver-documents/${PATH}`);
    expect(tmpKey("truck-documents", PATH)).toBe(`tmp/truck-documents/${PATH}`);
    expect(code(() => objectKey("receipts", "../etc/passwd"))).toBe("path");
    expect(code(() => objectKey("other" as never, PATH))).toBe("path");
  });
  it("only lets a user attach their own fresh upload of the right kind", () => {
    expect(ownedUploadPath(`tmp/receipts/${PATH}`, "receipts", USER)).toBe(PATH);
    expect(ownedUploadPath(`tmp/receipts/${PATH}`, "receipts", OTHER)).toBeNull();
    expect(ownedUploadPath(`tmp/receipts/${PATH}`, "truck-documents", USER)).toBeNull();
    expect(ownedUploadPath(`receipts/${PATH}`, "receipts", USER)).toBeNull();
    expect(ownedUploadPath(`tmp/receipts/${OTHER}/2026-10/${FILE}.jpg`, "receipts", USER)).toBeNull();
    expect(ownedUploadPath(`tmp/receipts/${USER}/../${OTHER}/2026-10/${FILE}.jpg`, "receipts", USER)).toBeNull();
  });
  it("server-chosen paths are in the user's folder and month", () => {
    const p = newPath(USER, "pdf", new Date("2026-10-26T10:00:00Z"));
    expect(parsePath(p)).toMatchObject({ userId: USER, month: "2026-10", ext: "pdf" });
    expect(newPath(USER, "pdf")).not.toBe(newPath(USER, "pdf"));
    expect(code(() => newPath("../x", "jpg"))).toBe("path");
  });
});

describe("upload rules", () => {
  it("allows JPEG, PNG, WebP, HEIC and PDF up to 10 MB", () => {
    expect(checkUpload("image/jpeg", 1)).toBe("jpg");
    expect(checkUpload("image/heic", 5_000_000)).toBe("heic");
    expect(checkUpload("application/pdf", MAX_BYTES)).toBe("pdf");
  });
  it("refuses other types, empty files and anything over 10 MB", () => {
    expect(code(() => checkUpload("text/plain", 10))).toBe("type");
    expect(code(() => checkUpload("image/svg+xml", 10))).toBe("type");
    expect(code(() => checkUpload("", 10))).toBe("type");
    expect(code(() => checkUpload("image/jpeg", 0))).toBe("size");
    expect(code(() => checkUpload("image/jpeg", 1.5))).toBe("size");
    expect(code(() => checkUpload("application/pdf", MAX_BYTES + 1))).toBe("size");
  });
});

describe("signed links", () => {
  const now = new Date("2026-10-26T10:00:00Z");

  it("upload link: PUT to a server-chosen tmp key, 5 minutes, locked to type and size", async () => {
    const link = await createUploadLink({ kind: "receipts", userId: USER, contentType: "image/jpeg", size: 1234, now });
    const url = new URL(link.url);
    expect(url.host).toBe("0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com");
    expect(url.pathname).toBe(`/trucking-files/${link.key}`);
    expect(ownedUploadPath(link.key, "receipts", USER)).not.toBeNull();
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(url.searchParams.get("X-Amz-Credential")).toBe("test-key/20261026/auto/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(link.url).not.toContain("test-secret");
  });

  it("upload link never lasts longer than 5 minutes", async () => {
    const link = await createUploadLink({ kind: "receipts", userId: USER, contentType: "image/png", size: 10, ttlSeconds: 86400, now });
    expect(new URL(link.url).searchParams.get("X-Amz-Expires")).toBe("300");
  });

  it("upload link refuses a bad type or size before signing", async () => {
    await expect(createUploadLink({ kind: "receipts", userId: USER, contentType: "text/html", size: 10 })).rejects.toMatchObject({ code: "type" });
    await expect(createUploadLink({ kind: "receipts", userId: USER, contentType: "image/jpeg", size: MAX_BYTES + 1 })).rejects.toMatchObject({ code: "size" });
  });

  it("view link: GET, 10 minutes by default, never more than 30", async () => {
    const url = new URL(await createViewLink("receipts", PATH, undefined, now));
    expect(url.pathname).toBe(`/trucking-files/receipts/${PATH}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    const long = new URL(await createViewLink("receipts", PATH, 7 * 86400, now));
    expect(long.searchParams.get("X-Amz-Expires")).toBe("1800");
  });

  it("view link refuses a path outside the layout", async () => {
    await expect(createViewLink("receipts", "../secret.jpg")).rejects.toMatchObject({ code: "path" });
  });
});
