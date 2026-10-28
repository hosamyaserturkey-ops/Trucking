import { describe, expect, it } from "vitest";
import { licenceUpload, parseTruckLicence } from "./licence";

const USER = "11111111-1111-4111-8111-111111111111";
const form = (data: Record<string, string>) => (name: string) => data[name] ?? null;
const KEY = `tmp/driver-documents/${USER}/2026-10/22222222-2222-4222-8222-222222222222.pdf`;

describe("licenceUpload", () => {
  it("is optional, and must be the user's own upload of that kind", () => {
    expect(licenceUpload(form({}), "driver-documents", USER)).toEqual({ ok: true, key: null });
    expect(licenceUpload(form({ receipt_upload: KEY }), "driver-documents", USER)).toEqual({ ok: true, key: KEY });
    expect(licenceUpload(form({ receipt_upload: KEY }), "truck-documents", USER)).toEqual({ ok: false, error: "ملف الرخصة غير صالح" });
    expect(licenceUpload(form({ receipt_upload: KEY.replace(USER, "33333333-3333-4333-8333-333333333333") }), "driver-documents", USER).ok).toBe(false);
    expect(licenceUpload(form({ receipt_upload: `tmp/driver-documents/${USER}/../x.pdf` }), "driver-documents", USER).ok).toBe(false);
  });
});

describe("parseTruckLicence", () => {
  it("reads the number and expiry, or nothing when both are empty", () => {
    expect(parseTruckLicence(form({}))).toEqual({ ok: true, values: null });
    expect(parseTruckLicence(form({ licence_number: " ١٢٣٤٥ ", licence_expiry: "2027-03-31" }))).toEqual({
      ok: true,
      values: { doc_number: "12345", expiry_date: "2027-03-31" },
    });
    expect(parseTruckLicence(form({ licence_expiry: "2027-03-31" }))).toEqual({ ok: true, values: { doc_number: null, expiry_date: "2027-03-31" } });
  });
  it("refuses a bad date or a long number", () => {
    expect(parseTruckLicence(form({ licence_expiry: "31/03/2027" }))).toEqual({ ok: false, error: "تاريخ انتهاء رخصة الشاحنة غير صحيح" });
    expect(parseTruckLicence(form({ licence_number: "x".repeat(41) }))).toEqual({ ok: false, error: "رقم رخصة الشاحنة طويل جداً" });
  });
});
