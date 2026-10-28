import { describe, expect, it } from "vitest";
import { parseCustomsDocument, parsePortalUrl } from "./customs";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TRIP = "11111111-1111-4111-8111-111111111111";
const form = (data: Record<string, string>) => (name: string) => data[name] ?? null;
const opts = { userId: USER, today: "2026-10-28" };
const upload = `tmp/customs-documents/${USER}/2026-10/x.pdf`;

describe("parseCustomsDocument", () => {
  it("takes the number (Arabic digits too), date, load and file", () => {
    expect(
      parseCustomsDocument(form({ declaration_no: " ٢٠٢٦/١٢٣٤ ", declaration_date: "2026-10-20", trip_id: TRIP, receipt_upload: upload }), opts),
    ).toEqual({
      ok: true,
      values: { declaration_no: "2026/1234", declaration_date: "2026-10-20", trip_id: TRIP, notes: null, receipt_upload: upload },
    });
  });
  it("needs a number and the file, from the user's own customs upload", () => {
    expect(parseCustomsDocument(form({ receipt_upload: upload }), opts)).toEqual({ ok: false, error: "أدخل رقم البيان الجمركي" });
    expect(parseCustomsDocument(form({ declaration_no: "1" }), opts)).toEqual({ ok: false, error: "أرفق ملف البيان (PDF أو صورة)" });
    expect(parseCustomsDocument(form({ declaration_no: "1", receipt_upload: `tmp/receipts/${USER}/2026-10/x.pdf` }), opts).ok).toBe(false);
    expect(parseCustomsDocument(form({ declaration_no: "1", receipt_upload: `tmp/customs-documents/other/2026-10/x.pdf` }), opts).ok).toBe(false);
  });
  it("refuses a future date and a bad load", () => {
    expect(parseCustomsDocument(form({ declaration_no: "1", declaration_date: "2026-10-29", receipt_upload: upload }), opts).ok).toBe(false);
    expect(parseCustomsDocument(form({ declaration_no: "1", trip_id: "x", receipt_upload: upload }), opts).ok).toBe(false);
  });
});

describe("parsePortalUrl", () => {
  it("accepts https links only", () => {
    expect(parsePortalUrl(" https://www.customs.gov.jo/ar/inquiry ")).toBe("https://www.customs.gov.jo/ar/inquiry");
    expect(parsePortalUrl("http://www.customs.gov.jo")).toBeNull();
    expect(parsePortalUrl("javascript:alert(1)")).toBeNull();
    expect(parsePortalUrl("https://a b")).toBeNull();
  });
});
