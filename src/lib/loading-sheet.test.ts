import { describe, expect, it } from "vitest";
import { parseLoadForm, sheetTotals } from "./loading-sheet";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";
const TODAY = "2026-10-28";

const form = (data: Record<string, string>) => (name: string) => data[name] ?? null;
const base = { load_date: "2026-10-27", truck_id: A, client_id: D, from_location_id: B, to_location_id: C, freight: "180" };

describe("parseLoadForm", () => {
  it("saves a line as a finished sheet load with freight in fils", () => {
    const r = parseLoadForm(
      form({ ...base, cargo_description: "إسمنت", cargo_weight_tons: "32.5", client_doc_no: " BL-778 " }),
      TODAY,
    );
    expect(r).toEqual({
      ok: true,
      values: expect.objectContaining({
        entry_source: "sheet",
        status: "completed",
        start_date: "2026-10-27",
        freight_minor: 180_000,
        currency: "JOD",
        fx_rate: 1,
        cargo_weight_tons: 32.5,
        client_doc_no: "BL-778",
        driver_id: null,
      }),
    });
  });

  it("takes USD freight with an exchange rate", () => {
    const r = parseLoadForm(form({ ...base, currency: "USD", freight: "1,250.50", fx_rate: "0.709" }), TODAY);
    expect(r.ok && r.values).toMatchObject({ currency: "USD", freight_minor: 125_050, fx_rate: 0.709 });
  });

  it("needs a customer, both places and a freight", () => {
    expect(parseLoadForm(form({ ...base, client_id: "" }), TODAY)).toEqual({ ok: false, error: "اختر الزبون" });
    expect(parseLoadForm(form({ ...base, to_location_id: "" }), TODAY)).toMatchObject({ ok: false });
    expect(parseLoadForm(form({ ...base, to_location_id: B }), TODAY)).toEqual({
      ok: false,
      error: "مكان التحميل والتنزيل متطابقان",
    });
    expect(parseLoadForm(form({ ...base, freight: "0" }), TODAY)).toEqual({ ok: false, error: "أدخل الأجرة" });
  });

  it("refuses a future date, a bad weight and a missing USD rate", () => {
    expect(parseLoadForm(form({ ...base, load_date: "2026-10-29" }), TODAY)).toMatchObject({ ok: false });
    expect(parseLoadForm(form({ ...base, cargo_weight_tons: "abc" }), TODAY)).toEqual({ ok: false, error: "الوزن غير صحيح" });
    expect(parseLoadForm(form({ ...base, currency: "USD", fx_rate: "" }), TODAY)).toEqual({
      ok: false,
      error: "سعر الصرف غير صحيح",
    });
  });

  it("ignores any reference sent by the browser; the database sets it", () => {
    const r = parseLoadForm(form({ ...base, client_ref: "HACK-1" }), TODAY);
    expect(r.ok && "client_ref" in r.values).toBe(false);
  });
});

describe("sheetTotals", () => {
  it("adds loads, tons and freight", () => {
    expect(
      sheetTotals([
        { cargo_weight_tons: 32.5, freight_base_minor: 180_000 },
        { cargo_weight_tons: null, freight_base_minor: 90_500 },
        { cargo_weight_tons: 24.25, freight_base_minor: 150_000 },
      ]),
    ).toEqual({ loads: 3, tons: 56.75, freightBaseMinor: 420_500 });
  });
});
