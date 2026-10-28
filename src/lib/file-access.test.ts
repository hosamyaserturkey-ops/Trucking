import { describe, expect, it, vi } from "vitest";

// file-access imports the Supabase server client (next/headers); the pure rules don't need it.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getProfile: vi.fn() }));

const { canReplaceFile, decideUpload, storageErrorMessage, UPLOAD_PURPOSES } = await import("./file-access");
const { StorageError } = await import("./storage");

describe("decideUpload", () => {
  const table = {
    expense_receipt: { driver: true, manager: true, accountant: true, dispatcher: false },
    fuel_receipt: { driver: true, manager: true, accountant: true, dispatcher: true },
    truck_document: { driver: false, manager: true, accountant: false, dispatcher: true },
    customs_document: { driver: false, manager: true, accountant: true, dispatcher: true },
    driver_license: { driver: false, manager: true, accountant: true, dispatcher: true },
  } as const;

  it("matches who may write each kind of row today", () => {
    for (const purpose of UPLOAD_PURPOSES) {
      for (const [role, allowed] of Object.entries(table[purpose])) {
        expect(decideUpload(role as never, purpose), `${role} ${purpose}`).toBe(allowed);
      }
    }
  });

  it("refuses users without a role", () => {
    expect(decideUpload(null, "expense_receipt")).toBe(false);
    expect(decideUpload(undefined, "fuel_receipt")).toBe(false);
  });
});

describe("canReplaceFile", () => {
  it("allows a new or still-waiting row", () => {
    expect(canReplaceFile({})).toBe(true);
    expect(canReplaceFile({ reviewed_at: null, settlement_id: null })).toBe(true);
  });
  it("locks the file once the row is reviewed or settled", () => {
    expect(canReplaceFile({ reviewed_at: "2026-10-26T10:00:00Z" })).toBe(false);
    expect(canReplaceFile({ settlement_id: "11111111-1111-4111-8111-111111111111" })).toBe(false);
  });
});

describe("storageErrorMessage", () => {
  it("explains each failure in Arabic", () => {
    expect(storageErrorMessage(new StorageError("type", "x"))).toContain("نوع الملف غير مسموح");
    expect(storageErrorMessage(new StorageError("size", "x"))).toContain("10 ميغابايت");
    expect(storageErrorMessage(new StorageError("config", "x"))).toContain("غير مُعدّ");
    expect(storageErrorMessage(new Error("boom"))).toContain("تعذر");
  });
});
