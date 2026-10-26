import { describe, expect, it } from "vitest";
import { parseOdometer, parseTripForm } from "./trip-parse";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";

const form = (data: Record<string, string>) => (name: string) => data[name] ?? null;
const base = { truck_id: A, from_location_id: B, to_location_id: C, start_date: "2026-10-26", client_id: D, freight: "390" };

describe("parseTripForm", () => {
  it("parses a planned JOD trip and stores freight in fils", () => {
    const r = parseTripForm(form({ ...base, cargo_description: "إسمنت", cargo_weight_tons: "24.5" }));
    expect(r).toEqual({
      ok: true,
      values: expect.objectContaining({
        status: "planned",
        freight_minor: 390_000,
        fx_rate: 1,
        currency: "JOD",
        cargo_weight_tons: 24.5,
        is_empty_return: false,
        start_odometer: null,
      }),
    });
  });

  it("parses USD freight with an exchange rate", () => {
    const r = parseTripForm(form({ ...base, currency: "USD", freight: "2,150.50", fx_rate: "0.709" }));
    expect(r.ok && r.values.freight_minor).toBe(215_050);
    expect(r.ok && r.values.fx_rate).toBe(0.709);
  });

  it("an empty return has no client and no freight", () => {
    const r = parseTripForm(form({ ...base, is_empty_return: "on", freight: "999" }));
    expect(r.ok && r.values).toMatchObject({ is_empty_return: true, client_id: null, freight_minor: 0, cargo_description: "عودة فارغة" });
  });

  it("starting now needs an odometer reading", () => {
    expect(parseTripForm(form({ ...base, status: "in_progress" }))).toEqual({ ok: false, error: "أدخل قراءة العداد لبدء الرحلة الآن" });
    const r = parseTripForm(form({ ...base, status: "in_progress", start_odometer: "389032" }));
    expect(r.ok && r.values).toMatchObject({ status: "in_progress", start_odometer: 389_032 });
  });

  it("rejects missing or inconsistent fields", () => {
    expect(parseTripForm(form({ ...base, truck_id: "" })).ok).toBe(false);
    expect(parseTripForm(form({ ...base, to_location_id: B })).ok).toBe(false);
    expect(parseTripForm(form({ ...base, client_id: "" })).ok).toBe(false);
    expect(parseTripForm(form({ ...base, freight: "0" })).ok).toBe(false);
    expect(parseTripForm(form({ ...base, freight: "1.2345" })).ok).toBe(false);
    expect(parseTripForm(form({ ...base, currency: "USD", freight: "10", fx_rate: "" })).ok).toBe(false);
    expect(parseTripForm(form({ ...base, start_date: "26/10/2026" })).ok).toBe(false);
  });
});

describe("parseOdometer", () => {
  it("accepts readings at or above the floor", () => {
    expect(parseOdometer("390000", 389_032)).toEqual({ ok: true, value: 390_000 });
    expect(parseOdometer("100", null)).toEqual({ ok: true, value: 100 });
  });

  it("rejects lower readings and junk", () => {
    expect(parseOdometer("389000", 389_032).ok).toBe(false);
    expect(parseOdometer("12.5", null).ok).toBe(false);
    expect(parseOdometer("", null).ok).toBe(false);
  });
});
