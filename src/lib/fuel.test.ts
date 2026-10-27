import { describe, expect, it } from "vitest";
import {
  formatQuantity,
  fuelCost,
  impliedKmPerLiter,
  isAbnormal,
  nowTime,
  parseFillup,
  parseFuelApproval,
  quantitySummary,
  weightedKmPerLiter,
  zonedIso,
} from "./fuel";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TRUCK = "11111111-1111-4111-8111-111111111111";
const TRIP = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-26T12:00:00Z"); // 15:00 in Amman
const form = (data: Record<string, string>) => (name: string) => data[name] ?? null;
const base = { filled_on: "2026-10-26", filled_time: "14:30", odometer: "389,500", qty_unit: "liter", quantity: "180.5", unit_price: "0.650", is_full_tank: "on" };
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
        qty_unit: "liter",
        quantity: 180.5,
        unit_price_minor: 650,
        is_full_tank: true,
        currency: "JOD",
        amount_minor: 117325,
        fx_rate: 1,
        payment_method: "driver_advance",
        notes: null,
        voucher_no: null,
        notice_no: null,
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
    const r = parseFillup(form({ ...base, odometer: "٣٨٩٥٠٠", quantity: "١٨٠٫٥", receipt_upload: receipt }), opts);
    expect(r.ok && [r.values.odometer, r.values.quantity]).toEqual([389500, 180.5]);
  });

  it("refuses a future time, bad readings and absurd quantities", () => {
    expect(parseFillup(form({ ...base, filled_time: "16:00", receipt_upload: receipt }), opts).ok).toBe(false);
    expect(parseFillup(form({ ...base, odometer: "abc", receipt_upload: receipt }), opts).ok).toBe(false);
    expect(parseFillup(form({ ...base, quantity: "0", receipt_upload: receipt }), opts)).toEqual({ ok: false, error: "أدخل عدد اللترات" });
    expect(parseFillup(form({ ...base, quantity: "2500", receipt_upload: receipt }), opts).ok).toBe(false);
    expect(parseFillup(form({ ...base, quantity: "10.123", receipt_upload: receipt }), opts).ok).toBe(false);
    expect(parseFillup(form({ ...base, unit_price: "0", receipt_upload: receipt }), opts)).toEqual({ ok: false, error: "أدخل سعر اللتر" });
    expect(parseFillup(form({ ...base, qty_unit: "barrel", receipt_upload: receipt }), opts).ok).toBe(false);
  });

  it("buys by the gallon (قلن) or the tank (تنكة): cost = quantity x price per unit", () => {
    const gallon = parseFillup(form({ ...base, qty_unit: "gallon", quantity: "30", unit_price: "3", receipt_upload: receipt }), opts);
    expect(gallon.ok && gallon.values).toMatchObject({ qty_unit: "gallon", quantity: 30, unit_price_minor: 3000, amount_minor: 90000 });
    const tank = parseFillup(form({ ...base, qty_unit: "tank", quantity: "6", unit_price: "13", receipt_upload: receipt }), opts);
    expect(tank.ok && tank.values).toMatchObject({ qty_unit: "tank", quantity: 6, amount_minor: 78000 });
    expect(parseFillup(form({ ...base, qty_unit: "gallon", quantity: "", receipt_upload: receipt }), opts)).toEqual({
      ok: false,
      error: "أدخل عدد القلنات",
    });
    expect(parseFillup(form({ ...base, qty_unit: "tank", unit_price: "", receipt_upload: receipt }), opts)).toEqual({
      ok: false,
      error: "أدخل سعر التنكة",
    });
  });

  it("a form without a unit is in liters", () => {
    const r = parseFillup(form({ ...base, qty_unit: "", receipt_upload: receipt }), opts);
    expect(r.ok && r.values.qty_unit).toBe("liter");
  });

  it("leaves the USD rate to the server unless one is given", () => {
    const r = parseFillup(form({ ...base, currency: "USD", quantity: "100", unit_price: "1.20", receipt_upload: receipt }), opts);
    expect(r.ok && r.values).toMatchObject({ currency: "USD", unit_price_minor: 120, amount_minor: 12000, fx_rate: null });
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

  it("keeps the voucher and notice numbers; a driver's phone sends none", () => {
    const r = parseFillup(form({ ...base, truck_id: TRUCK, voucher_no: "١٢٣", notice_no: "N-1" }), opts);
    expect(r.ok && r.values).toMatchObject({ voucher_no: "123", notice_no: "N-1" });
    const d = parseFillup(form({ ...base, voucher_no: "123", receipt_upload: `tmp/receipts/${USER}/2026-10/x.jpg` }), {
      mode: "driver",
      userId: USER,
      now: NOW,
    });
    expect(d.ok && d.values.voucher_no).toBeNull();
  });

  it("paid from an advance needs the driver", () => {
    expect(parseFillup(form({ ...base, truck_id: TRUCK, payment_method: "driver_advance" }), opts).ok).toBe(false);
    expect(parseFillup(form({ ...base, truck_id: TRUCK, payment_method: "driver_advance", driver_id: TRIP }), opts).ok).toBe(true);
  });
});

describe("km/L, cost and quantity", () => {
  const full = (odometer: number, liters: number | null) => ({ odometer, liters, is_full_tank: true });
  const part = (odometer: number, liters: number | null) => ({ odometer, liters, is_full_tank: false });

  it("uses km since the last full tank over all liters since then", () => {
    expect(impliedKmPerLiter(full(1500, 100), [part(1200, 50), full(1000, 80)])).toBe(3.33);
    expect(impliedKmPerLiter(full(1500, 100), [full(1000, 80)])).toBe(5);
  });
  it("has no figure for a partial fill, no earlier full tank, or no distance", () => {
    expect(impliedKmPerLiter(part(1500, 100), [full(1000, 80)])).toBeNull();
    expect(impliedKmPerLiter(full(1500, 100), [part(1200, 50)])).toBeNull();
    expect(impliedKmPerLiter(full(1000, 100), [full(1000, 80)])).toBeNull();
  });
  it("has no figure when a fill-up since the last full tank was in gallons or tanks", () => {
    expect(impliedKmPerLiter(full(1500, 100), [part(1200, null), full(1000, 80)])).toBeNull();
    expect(impliedKmPerLiter(full(1500, null), [full(1000, 80)])).toBeNull();
    // A gallon fill-up before the last full tank doesn't matter.
    expect(impliedKmPerLiter(full(1500, 100), [full(1000, 80), part(900, null)])).toBe(5);
  });
  it("flags consumption below the baseline by more than the threshold", () => {
    expect(isAbnormal(2.4, 3, 15)).toBe(true);
    expect(isAbnormal(2.6, 3, 15)).toBe(false);
    expect(isAbnormal(null, 3, 15)).toBe(false);
    expect(isAbnormal(2, null, 15)).toBe(false);
  });
  it("costs quantity x unit price, rounded to the fils", () => {
    expect(fuelCost(180.5, 650)).toBe(117325);
    expect(fuelCost(2.25, 1333)).toBe(2999);
  });
  it("sums quantities per unit", () => {
    expect(
      quantitySummary([
        { qty_unit: "liter", quantity: 100.25 },
        { qty_unit: "gallon", quantity: 30 },
        { qty_unit: "liter", quantity: 1100 },
      ]),
    ).toBe("1,200.25 لتر · 30 قلن");
    expect(quantitySummary([{ qty_unit: "liter", quantity: 100.6 }], 0)).toBe("101 لتر");
    expect(quantitySummary([])).toBe("");
  });
  it("shows the quantity with its unit", () => {
    expect(formatQuantity(120.5, "liter")).toBe("120.5 لتر");
    expect(formatQuantity(30, "gallon")).toBe("30 قلن");
    expect(formatQuantity(6, "tank")).toBe("6 تنكة");
    expect(formatQuantity(null, "liter")).toBe("—");
  });
});

describe("parseFuelApproval", () => {
  it("takes the corrected quantity, unit price, odometer and full-tank flag", () => {
    expect(
      parseFuelApproval(form({ quantity: "175", unit_price: "0.650", odometer: "389,480", is_full_tank: "on" }), "JOD", "liter"),
    ).toEqual({
      ok: true,
      values: { quantity: 175, unit_price_minor: 650, odometer: 389480, is_full_tank: true },
    });
  });
  it("keeps the fill-up's own unit", () => {
    const r = parseFuelApproval(form({ quantity: "32", unit_price: "3.100", odometer: "1" }), "JOD", "gallon");
    expect(r.ok && r.values).toMatchObject({ quantity: 32, unit_price_minor: 3100 });
    expect(parseFuelApproval(form({ quantity: "", unit_price: "3", odometer: "1" }), "JOD", "tank")).toEqual({
      ok: false,
      error: "أدخل عدد التنكات",
    });
  });
  it("needs a rate for USD and refuses bad numbers", () => {
    expect(parseFuelApproval(form({ quantity: "100", unit_price: "0.90", odometer: "1" }), "USD", "liter").ok).toBe(false);
    const usd = parseFuelApproval(form({ quantity: "100", unit_price: "0.90", odometer: "1", fx_rate: "0.709" }), "USD", "liter");
    expect(usd.ok && usd.values).toMatchObject({ unit_price_minor: 90, fx_rate: 0.709, is_full_tank: false });
    expect(parseFuelApproval(form({ quantity: "0", unit_price: "0.9", odometer: "1" }), "JOD", "liter").ok).toBe(false);
    expect(parseFuelApproval(form({ quantity: "10", unit_price: "-1", odometer: "1" }), "JOD", "liter").ok).toBe(false);
    expect(parseFuelApproval(form({ quantity: "10", unit_price: "1", odometer: "x" }), "JOD", "liter").ok).toBe(false);
  });
});

describe("weightedKmPerLiter", () => {
  it("weights by distance and skips unmeasured rows", () => {
    // 1000 km at 2.5 (400 L) + 200 km at 4 (50 L) = 1200 km / 450 L
    expect(weightedKmPerLiter([{ km: 1000, kmPerLiter: 2.5 }, { km: 200, kmPerLiter: 4 }, { km: null, kmPerLiter: null }])).toBe(2.67);
    expect(weightedKmPerLiter([])).toBeNull();
  });
});
