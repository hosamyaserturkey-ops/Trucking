import { describe, expect, it } from "vitest";
import {
  lineTotal,
  parseCancelReason,
  parseCloseWorkOrder,
  parseServiceSchedule,
  parseWorkOrder,
  parseWorkOrderLine,
  splitByAccount,
} from "./work-orders";

const TRUCK = "11111111-1111-4111-8111-111111111111";
const SHOP = "22222222-2222-4222-8222-222222222222";
const SCHED = "33333333-3333-4333-8333-333333333333";
const form = (data: Record<string, string>) => (name: string) => data[name] ?? null;
const all = (data: Record<string, string[]>) => (name: string) => data[name] ?? [];
const today = "2026-10-31";

describe("parseWorkOrder", () => {
  it("takes the truck, workshop, kind, odometer and what is being done", () => {
    expect(
      parseWorkOrder(
        form({ truck_id: TRUCK, workshop_id: SHOP, kind: "repair", odometer: "٤٥٠,١٢٠", description: "  تبديل   الكلتش ", opened_on: "2026-10-30" }),
        { today },
      ),
    ).toEqual({
      ok: true,
      values: {
        truck_id: TRUCK,
        workshop_id: SHOP,
        kind: "repair",
        opened_on: "2026-10-30",
        odometer: 450120,
        description: "تبديل الكلتش",
        invoice_no: null,
        notes: null,
      },
    });
  });
  it("opens today by default; the workshop and odometer may wait", () => {
    const r = parseWorkOrder(form({ truck_id: TRUCK, kind: "service", description: "زيت" }), { today });
    expect(r).toMatchObject({ ok: true, values: { opened_on: today, workshop_id: null, odometer: null } });
  });
  it("refuses what the database would", () => {
    expect(parseWorkOrder(form({ kind: "repair", description: "x" }), { today })).toEqual({ ok: false, error: "اختر الشاحنة" });
    expect(parseWorkOrder(form({ truck_id: TRUCK, kind: "wash", description: "x" }), { today })).toEqual({ ok: false, error: "اختر نوع الصيانة" });
    expect(parseWorkOrder(form({ truck_id: TRUCK, kind: "repair", description: "" }), { today })).toEqual({ ok: false, error: "اكتب وصف العمل المطلوب" });
    expect(parseWorkOrder(form({ truck_id: TRUCK, kind: "repair", description: "x", opened_on: "2026-11-01" }), { today })).toEqual({
      ok: false,
      error: "تاريخ الفتح غير صحيح",
    });
    expect(parseWorkOrder(form({ truck_id: TRUCK, kind: "repair", description: "x", odometer: "12.5" }), { today })).toEqual({
      ok: false,
      error: "قراءة العداد غير صحيحة",
    });
  });
});

describe("parseWorkOrderLine", () => {
  it("takes a part with its number, quantity and price in JOD", () => {
    expect(parseWorkOrderLine(form({ line_type: "part", description: "فلتر زيت", part_number: "FLT-OIL", quantity: "2", unit_price: "9.5" }))).toEqual({
      ok: true,
      values: { line_type: "part", description: "فلتر زيت", part_number: "FLT-OIL", quantity: 2, unit_price_minor: 9500 },
    });
  });
  it("quantity defaults to one; labour may be free", () => {
    expect(parseWorkOrderLine(form({ line_type: "labor", description: "أجور", unit_price: "0" }))).toMatchObject({
      ok: true,
      values: { quantity: 1, unit_price_minor: 0 },
    });
  });
  it("refuses a bad quantity or a missing price", () => {
    expect(parseWorkOrderLine(form({ line_type: "part", description: "x", quantity: "0", unit_price: "1" }))).toEqual({ ok: false, error: "الكمية غير صحيحة" });
    expect(parseWorkOrderLine(form({ line_type: "part", description: "x", quantity: "1.234", unit_price: "1" }))).toEqual({ ok: false, error: "الكمية غير صحيحة" });
    expect(parseWorkOrderLine(form({ line_type: "part", description: "x" }))).toEqual({ ok: false, error: "أدخل سعر الوحدة" });
    expect(parseWorkOrderLine(form({ line_type: "fuel", description: "x", unit_price: "1" }))).toEqual({ ok: false, error: "اختر نوع البند" });
  });
});

describe("lineTotal", () => {
  it("rounds quantity × price half away from zero, like the database", () => {
    expect(lineTotal(40, 3200)).toBe(128000);
    expect(lineTotal(1.5, 333)).toBe(500); // 499.5 -> 500
    expect(lineTotal(2.25, 1001)).toBe(2252); // 2252.25 -> 2252
    expect(lineTotal(0.01, 50)).toBe(1); // 0.5 -> 1
  });
});

describe("parseCloseWorkOrder", () => {
  const opts = { today, openedOn: "2026-10-28", hasWorkshop: true };
  it("closes on credit with the invoice number and the services done", () => {
    expect(
      parseCloseWorkOrder(form({ payment_method: "credit", invoice_no: "WS-77", voucher_no: "9" }), all({ schedule_id: [SCHED, SCHED] }), opts),
    ).toEqual({
      ok: true,
      values: { closed_on: today, payment_method: "credit", invoice_no: "WS-77", voucher_no: null, notice_no: null, schedule_ids: [SCHED] },
    });
  });
  it("keeps the voucher number for cash and the notice number for a transfer", () => {
    expect(parseCloseWorkOrder(form({ payment_method: "cash", voucher_no: "٥٥" }), all({}), opts)).toMatchObject({
      ok: true,
      values: { voucher_no: "55", notice_no: null },
    });
    expect(parseCloseWorkOrder(form({ payment_method: "bank", voucher_no: "55", notice_no: "N-1" }), all({}), opts)).toMatchObject({
      ok: true,
      values: { voucher_no: null, notice_no: "N-1" },
    });
  });
  it("needs a workshop on credit, and a date between opening and today", () => {
    expect(parseCloseWorkOrder(form({ payment_method: "credit" }), all({}), { ...opts, hasWorkshop: false })).toEqual({
      ok: false,
      error: "اختر الورشة أولاً لتسجيل الفاتورة على حسابها",
    });
    expect(parseCloseWorkOrder(form({ payment_method: "cash", closed_on: "2026-10-27" }), all({}), opts)).toEqual({
      ok: false,
      error: "تاريخ الإغلاق قبل تاريخ فتح الأمر",
    });
    expect(parseCloseWorkOrder(form({ payment_method: "cash", closed_on: "2026-11-02" }), all({}), opts)).toEqual({
      ok: false,
      error: "تاريخ الإغلاق غير صحيح",
    });
    expect(parseCloseWorkOrder(form({}), all({}), opts)).toEqual({ ok: false, error: "اختر طريقة الدفع" });
  });
});

describe("parseCancelReason", () => {
  it("needs a reason", () => {
    expect(parseCancelReason(form({ cancel_reason: "  " }))).toEqual({ ok: false, error: "اكتب سبب الإلغاء" });
    expect(parseCancelReason(form({ cancel_reason: " فُتح بالخطأ " }))).toEqual({ ok: true, values: { cancel_reason: "فُتح بالخطأ" } });
  });
});

describe("parseServiceSchedule", () => {
  it("takes a service every so many km and days, with when it was last done", () => {
    expect(
      parseServiceSchedule(
        form({ truck_id: TRUCK, service_name: "تغيير زيت", interval_km: "20,000", interval_days: "180", last_done_odometer: "400000", last_done_on: "2026-09-01" }),
        { today },
      ),
    ).toEqual({
      ok: true,
      values: {
        truck_id: TRUCK,
        service_name: "تغيير زيت",
        interval_km: 20000,
        interval_days: 180,
        last_done_odometer: 400000,
        last_done_on: "2026-09-01",
        is_active: true,
      },
    });
  });
  it("needs an interval, and the last reading or date that goes with it", () => {
    expect(parseServiceSchedule(form({ truck_id: TRUCK, service_name: "x" }), { today })).toEqual({ ok: false, error: "حدد كل كم كيلومتر أو كل كم يوم" });
    expect(parseServiceSchedule(form({ truck_id: TRUCK, service_name: "x", interval_km: "10000" }), { today })).toEqual({
      ok: false,
      error: "أدخل قراءة العداد عند آخر صيانة",
    });
    expect(parseServiceSchedule(form({ truck_id: TRUCK, service_name: "x", interval_days: "90" }), { today })).toEqual({
      ok: false,
      error: "أدخل تاريخ آخر صيانة",
    });
    expect(parseServiceSchedule(form({ truck_id: TRUCK, service_name: "x", interval_km: "0" }), { today })).toEqual({
      ok: false,
      error: "المسافة بين الصيانات غير صحيحة",
    });
  });
});

describe("splitByAccount", () => {
  it("puts tires on their own account", () => {
    expect(
      splitByAccount([
        { line_type: "part", line_total_minor: 1000 },
        { line_type: "tire", line_total_minor: 5000 },
        { line_type: "labor", line_total_minor: 250 },
      ]),
    ).toEqual({ maintenance: 1250, tires: 5000 });
  });
});
