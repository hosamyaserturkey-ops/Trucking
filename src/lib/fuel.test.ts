import { describe, expect, it } from "vitest";
import { impliedKmPerLiter, isAbnormal, nowTime, parseFillup, parseFuelApproval, pricePerLiter, weightedKmPerLiter, zonedIso } from "./fuel";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TRUCK = "11111111-1111-4111-8111-111111111111";
const TRIP = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-26T12:00:00Z"); // 15:00 in Amman
const form = (data: Record<string, string>) => (name: string) => data[name] ?? null;
const base = { filled_on: "2026-10-26", filled_time: "14:30", odometer: "389,500", liters: "180.5", amount: "117.325", is_full_tank: "on" };
const receipt = `tmp/receipts/${USER}/2026-10/x.jpg`;

describe("zonedIso / nowTime", () => {
  it("reads date and time as Amman wall-clock time", () => {
    expect(zonedIso("2026-10-26", "14:30")).toBe("2026-10-26T11:30:00.000Z");
    expect(zonedIso("2026-01-01", "00:15")).toBe("2025-12-31T21:15:00.000Z");
    expect(nowTime(NOW)).toBe("15:00");
  });
});

describe("parseFillup (driver)", () => {
  const opts = { mode: "driver" as const, userId: USER, now: NOW, requireReceipt: true };

  it("parses a full fill-up paid from the advance", () => {
    expect(parseFillup(form({ ...base, trip_id: TRIP, receipt_upload: receipt }), opts)).toEqual({
      ok: true,
      values: {
        truck_id: null,
        driver_id: null,
        trip_id: TRIP,
        station_id: null,
        filled_at: "2026-10-26T11:30:00.000Z",
        odometer: 389500,
        liters: 180.5,
        is_full_tank: true,
        currency: "JOD",
        amount_minor: 117325,
        fx_rate: 1,
        payment_method: "driver_advance",
        notes: null,
        receipt_upload: receipt,
      },
    });
  });

  it("ignores a payment method sent by the phone", () => {
    const r = parseFillup(form({ ...base, receipt_upload: receipt, payment_method: "cash" }), opts);
    expect(r.ok && r.values.payment_method).toBe("driver_advance");
  });

  it("requires the receipt photo and keeps it to the driver's own folder", () => {
    expect(parseFillup(form(base), opts)).toEqual({ ok: false, error: "صوّر إيصال التعبئة" });
    expect(parseFillup(form({ ...base, receipt_upload: "tmp/receipts/other/2026-10/x.jpg" }), opts).ok).toBe(false);
    expect(parseFillup(form({ ...base, receipt_upload: `tmp/receipts/${USER}/../x.jpg` }), opts).ok).toBe(false);
  });

  it("accepts Arabic digits", () => {
    const r = parseFillup(form({ ...base, odometer: "٣٨٩٥٠٠", liters: "١٨٠٫٥", receipt_upload: receipt }), opts);
    expect(r.ok && [r.values.odometer, r.values.liters]).toEqual([389500, 180.5]);
  });

  it("refuses a future time, bad readings and absurd liters", () => {
    expect(parseFillup(form({ ...base, filled_time: "16:00", receipt_upload: receipt }), opts).ok).toBe(false);
    expect(parseFillup(form({ ...base, odometer: "abc", receipt_upload: receipt }), opts).ok).toBe(false);
    expect(parseFillup(form({ ...base, liters: "0", receipt_upload: receipt }), opts).ok).toBe(false);
    expect(parseFillup(form({ ...base, liters: "2500", receipt_upload: receipt }), opts).ok).toBe(false);
    expect(parseFillup(form({ ...base, liters: "10.123", receipt_upload: receipt }), opts).ok).toBe(false);
    expect(parseFillup(form({ ...base, amount: "0", receipt_upload: receipt }), opts).ok).toBe(false);
  });

  it("leaves the USD rate to the server unless one is given", () => {
    const r = parseFillup(form({ ...base, currency: "USD", amount: "120", receipt_upload: receipt }), opts);
    expect(r.ok && r.values).toMatchObject({ currency: "USD", amount_minor: 12000, fx_rate: null });
  });
});

describe("parseFillup (office)", () => {
  const opts = { mode: "office" as const, userId: USER, now: NOW };

  it("needs a truck and an office payment method", () => {
    expect(parseFillup(form(base), opts)).toEqual({ ok: false, error: "اختر الشاحنة" });
    const r = parseFillup(form({ ...base, truck_id: TRUCK, payment_method: "credit", is_full_tank: "" }), opts);
    expect(r.ok && r.values).toMatchObject({ truck_id: TRUCK, payment_method: "credit", is_full_tank: false, receipt_upload: null });
    expect(parseFillup(form({ ...base, truck_id: TRUCK, payment_method: "own_tank" }), opts).ok).toBe(false);
  });

  it("paid from an advance needs the driver", () => {
    expect(parseFillup(form({ ...base, truck_id: TRUCK, payment_method: "driver_advance" }), opts).ok).toBe(false);
    expect(parseFillup(form({ ...base, truck_id: TRUCK, payment_method: "driver_advance", driver_id: TRIP }), opts).ok).toBe(true);
  });
});

describe("km/L and price", () => {
  const full = (odometer: number, liters: number) => ({ odometer, liters, is_full_tank: true });
  const part = (odometer: number, liters: number) => ({ odometer, liters, is_full_tank: false });

  it("uses km since the last full tank over all liters since then", () => {
    expect(impliedKmPerLiter(full(1500, 100), [part(1200, 50), full(1000, 80)])).toBe(3.33);
    expect(impliedKmPerLiter(full(1500, 100), [full(1000, 80)])).toBe(5);
  });
  it("has no figure for a partial fill, no earlier full tank, or no distance", () => {
    expect(impliedKmPerLiter(part(1500, 100), [full(1000, 80)])).toBeNull();
    expect(impliedKmPerLiter(full(1500, 100), [part(1200, 50)])).toBeNull();
    expect(impliedKmPerLiter(full(1000, 100), [full(1000, 80)])).toBeNull();
  });
  it("flags consumption below the baseline by more than the threshold", () => {
    expect(isAbnormal(2.4, 3, 15)).toBe(true);
    expect(isAbnormal(2.6, 3, 15)).toBe(false);
    expect(isAbnormal(null, 3, 15)).toBe(false);
    expect(isAbnormal(2, null, 15)).toBe(false);
  });
  it("prices per liter in minor units", () => {
    expect(pricePerLiter(117325, 180.5)).toBe(650);
    expect(pricePerLiter(100, 0)).toBeNull();
  });
});

describe("parseFuelApproval", () => {
  it("takes the corrected liters, amount, odometer and full-tank flag", () => {
    expect(parseFuelApproval(form({ liters: "175", amount: "113.750", odometer: "389,480", is_full_tank: "on" }), "JOD")).toEqual({
      ok: true,
      values: { liters: 175, amount_minor: 113750, odometer: 389480, is_full_tank: true },
    });
  });
  it("needs a rate for USD and refuses bad numbers", () => {
    expect(parseFuelApproval(form({ liters: "100", amount: "90", odometer: "1" }), "USD").ok).toBe(false);
    const usd = parseFuelApproval(form({ liters: "100", amount: "90", odometer: "1", fx_rate: "0.709" }), "USD");
    expect(usd.ok && usd.values).toMatchObject({ amount_minor: 9000, fx_rate: 0.709, is_full_tank: false });
    expect(parseFuelApproval(form({ liters: "0", amount: "90", odometer: "1" }), "JOD").ok).toBe(false);
    expect(parseFuelApproval(form({ liters: "10", amount: "-1", odometer: "1" }), "JOD").ok).toBe(false);
    expect(parseFuelApproval(form({ liters: "10", amount: "1", odometer: "x" }), "JOD").ok).toBe(false);
  });
});

describe("weightedKmPerLiter", () => {
  it("weights by distance and skips unmeasured rows", () => {
    // 1000 km at 2.5 (400 L) + 200 km at 4 (50 L) = 1200 km / 450 L
    expect(weightedKmPerLiter([{ km: 1000, kmPerLiter: 2.5 }, { km: 200, kmPerLiter: 4 }, { km: null, kmPerLiter: null }])).toBe(2.67);
    expect(weightedKmPerLiter([])).toBeNull();
  });
});
