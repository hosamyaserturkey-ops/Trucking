import { describe, expect, it } from "vitest";
import { parseEntityForm } from "./master-data-parse";
import { ENTITIES, TRUCK_ASSETS } from "./master-data";

const form = (data: Record<string, string>) => (name: string) => data[name] ?? null;

describe("parseEntityForm", () => {
  it("parses a truck and turns empty optional fields into null", () => {
    const result = parseEntityForm(
      ENTITIES.trucks.fields,
      form({ code: " T-16 ", plate_number: "50-12345", year: "2022", expected_km_per_liter: "2.85", is_active: "on" }),
    );
    expect(result).toEqual({
      ok: true,
      values: expect.objectContaining({
        code: "T-16",
        plate_number: "50-12345",
        year: 2022,
        expected_km_per_liter: "2.85",
        is_active: true,
        make: null,
        vin: null,
      }),
    });
  });

  it("requires required fields", () => {
    const result = parseEntityForm(ENTITIES.trucks.fields, form({ plate_number: "50-1" }));
    expect(result).toEqual({ ok: false, error: "الحقل «رقم الأسطول» مطلوب" });
  });

  it("unchecked checkbox means false", () => {
    const result = parseEntityForm(ENTITIES.locations.fields, form({ name: "عمّان", country: "الأردن" }));
    expect(result.ok && result.values.is_active).toBe(false);
  });

  it("stores money as integer fils", () => {
    const result = parseEntityForm(
      TRUCK_ASSETS.fields,
      form({ purchase_cost_base_minor: "75,000.5", salvage_value_base_minor: "11250" }),
    );
    expect(result.ok && result.values.purchase_cost_base_minor).toBe(75_000_500);
    expect(result.ok && result.values.salvage_value_base_minor).toBe(11_250_000);
  });

  it("rejects bad numbers, dates and options", () => {
    expect(parseEntityForm(ENTITIES.trucks.fields, form({ code: "x", plate_number: "y", year: "20.5" })).ok).toBe(false);
    expect(parseEntityForm(ENTITIES.drivers.fields, form({ full_name: "x", license_expiry: "31/12/2026" })).ok).toBe(false);
    expect(parseEntityForm(ENTITIES.suppliers.fields, form({ name: "x", kind: "bank" })).ok).toBe(false);
    expect(
      parseEntityForm(TRUCK_ASSETS.fields, form({ purchase_cost_base_minor: "1.2345", salvage_value_base_minor: "0" })).ok,
    ).toBe(false);
  });
});
