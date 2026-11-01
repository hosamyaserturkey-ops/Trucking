import { parseMoney, toLatinDigits } from "@/lib/money";
import { parseDocNumbers } from "@/lib/doc-numbers";

// Pure helpers for maintenance work orders (أوامر الصيانة) and service
// schedules. Amounts are JOD fils. Messages are Arabic. The database enforces
// the same rules (migration 23); these keep the forms friendly.

type Get = (name: string) => string | null;
type Result<T> = { ok: true; values: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const WORK_ORDER_KINDS = ["service", "repair", "tires", "inspection", "other"] as const;
export const LINE_TYPES = ["part", "labor", "tire", "other"] as const;
export const WO_PAYMENT_METHODS = ["credit", "cash", "bank"] as const;

export type WorkOrderValues = {
  truck_id: string;
  workshop_id: string | null;
  kind: (typeof WORK_ORDER_KINDS)[number];
  opened_on: string;
  odometer: number | null;
  description: string;
  invoice_no: string | null;
  notes: string | null;
};

const text = (get: Get) => (name: string) => toLatinDigits((get(name) ?? "").trim());

function wholeNumber(raw: string): number | null | "bad" {
  const v = raw.replace(/[,\s]/g, "");
  if (!v) return null;
  if (!/^\d{1,8}$/.test(v)) return "bad";
  return Number(v);
}

/** The order's header: truck, workshop, kind, date, odometer and what is being done. */
export function parseWorkOrder(get: Get, opts: { today: string }): Result<WorkOrderValues> {
  const t = text(get);
  const truck_id = t("truck_id");
  if (!UUID.test(truck_id)) return { ok: false, error: "اختر الشاحنة" };
  const workshop = t("workshop_id");
  if (workshop && !UUID.test(workshop)) return { ok: false, error: "الورشة غير صحيحة" };
  const kind = t("kind") as WorkOrderValues["kind"];
  if (!WORK_ORDER_KINDS.includes(kind)) return { ok: false, error: "اختر نوع الصيانة" };
  const opened_on = t("opened_on") || opts.today;
  if (!ISO_DATE.test(opened_on) || opened_on > opts.today) return { ok: false, error: "تاريخ الفتح غير صحيح" };
  const odometer = wholeNumber(t("odometer"));
  if (odometer === "bad") return { ok: false, error: "قراءة العداد غير صحيحة" };
  const description = (get("description") ?? "").replace(/\s+/g, " ").trim();
  if (!description) return { ok: false, error: "اكتب وصف العمل المطلوب" };
  if (description.length > 200) return { ok: false, error: "الوصف طويل جداً" };
  const invoice_no = t("invoice_no") || null;
  if (invoice_no && invoice_no.length > 40) return { ok: false, error: "رقم فاتورة الورشة طويل جداً" };
  const notes = (get("notes") ?? "").trim();
  if (notes.length > 500) return { ok: false, error: "الملاحظات طويلة جداً" };
  return {
    ok: true,
    values: { truck_id, workshop_id: workshop || null, kind, opened_on, odometer, description, invoice_no, notes: notes || null },
  };
}

export type WorkOrderLineValues = {
  line_type: (typeof LINE_TYPES)[number];
  description: string;
  part_number: string | null;
  quantity: number;
  unit_price_minor: number;
};

/** One line: a part, labour, a tire or anything else, with quantity and unit price. */
export function parseWorkOrderLine(get: Get): Result<WorkOrderLineValues> {
  const t = text(get);
  const line_type = t("line_type") as WorkOrderLineValues["line_type"];
  if (!LINE_TYPES.includes(line_type)) return { ok: false, error: "اختر نوع البند" };
  const description = (get("description") ?? "").replace(/\s+/g, " ").trim();
  if (!description) return { ok: false, error: "اكتب وصف البند" };
  if (description.length > 200) return { ok: false, error: "وصف البند طويل جداً" };
  const part_number = t("part_number") || null;
  if (part_number && part_number.length > 40) return { ok: false, error: "رقم القطعة طويل جداً" };
  const qtyText = t("quantity").replace(/,/g, "") || "1";
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(qtyText) || Number(qtyText) <= 0) return { ok: false, error: "الكمية غير صحيحة" };
  const price = parseMoney(t("unit_price"), "JOD");
  if (price === null || price < 0n) return { ok: false, error: "أدخل سعر الوحدة" };
  return { ok: true, values: { line_type, description, part_number, quantity: Number(qtyText), unit_price_minor: Number(price) } };
}

/** Line total as the database computes it: round(quantity × unit price), half away from zero. */
export function lineTotal(quantity: number, unitPriceMinor: number): number {
  // Quantities have at most 2 decimals: work in hundredths to stay exact.
  const hundredths = Math.round(quantity * 100);
  const cents = hundredths * unitPriceMinor;
  return Math.sign(cents) * Math.floor((Math.abs(cents) + 50) / 100);
}

export type CloseValues = {
  closed_on: string;
  payment_method: (typeof WO_PAYMENT_METHODS)[number];
  invoice_no: string | null;
  voucher_no: string | null;
  notice_no: string | null;
  schedule_ids: string[];
};

/** Closing: the day the workshop's invoice came, how it is paid, and the services done. */
export function parseCloseWorkOrder(
  get: Get,
  getAll: (name: string) => string[],
  opts: { today: string; openedOn: string; hasWorkshop: boolean },
): Result<CloseValues> {
  const t = text(get);
  const closed_on = t("closed_on") || opts.today;
  if (!ISO_DATE.test(closed_on) || closed_on > opts.today) return { ok: false, error: "تاريخ الإغلاق غير صحيح" };
  if (closed_on < opts.openedOn) return { ok: false, error: "تاريخ الإغلاق قبل تاريخ فتح الأمر" };
  const payment_method = t("payment_method") as CloseValues["payment_method"];
  if (!WO_PAYMENT_METHODS.includes(payment_method)) return { ok: false, error: "اختر طريقة الدفع" };
  if (payment_method === "credit" && !opts.hasWorkshop) return { ok: false, error: "اختر الورشة أولاً لتسجيل الفاتورة على حسابها" };
  const invoice_no = t("invoice_no") || null;
  if (invoice_no && invoice_no.length > 40) return { ok: false, error: "رقم فاتورة الورشة طويل جداً" };
  const docs = parseDocNumbers(t, ["voucher_no", "notice_no"] as const);
  if (!docs.ok) return docs;
  const schedule_ids = [...new Set(getAll("schedule_id").map((s) => s.trim()).filter(Boolean))];
  if (schedule_ids.some((s) => !UUID.test(s))) return { ok: false, error: "الصيانة الدورية المختارة غير صحيحة" };
  return {
    ok: true,
    values: {
      closed_on,
      payment_method,
      invoice_no,
      voucher_no: payment_method === "cash" ? docs.values.voucher_no : null,
      notice_no: payment_method === "bank" ? docs.values.notice_no : null,
      schedule_ids,
    },
  };
}

/** A reason is needed to cancel an order. */
export function parseCancelReason(get: Get): Result<{ cancel_reason: string }> {
  const reason = (get("cancel_reason") ?? "").replace(/\s+/g, " ").trim();
  if (!reason) return { ok: false, error: "اكتب سبب الإلغاء" };
  if (reason.length > 300) return { ok: false, error: "السبب طويل جداً" };
  return { ok: true, values: { cancel_reason: reason } };
}

export type ScheduleValues = {
  truck_id: string;
  service_name: string;
  interval_km: number | null;
  interval_days: number | null;
  last_done_odometer: number | null;
  last_done_on: string | null;
  is_active: boolean;
};

/** A periodic service: every so many km and/or days, and when it was last done. */
export function parseServiceSchedule(get: Get, opts: { today: string }): Result<ScheduleValues> {
  const t = text(get);
  const truck_id = t("truck_id");
  if (!UUID.test(truck_id)) return { ok: false, error: "اختر الشاحنة" };
  const service_name = (get("service_name") ?? "").replace(/\s+/g, " ").trim();
  if (!service_name) return { ok: false, error: "اكتب اسم الصيانة" };
  if (service_name.length > 80) return { ok: false, error: "اسم الصيانة طويل جداً" };
  const km = wholeNumber(t("interval_km"));
  const days = wholeNumber(t("interval_days"));
  const lastKm = wholeNumber(t("last_done_odometer"));
  if (km === "bad" || km === 0) return { ok: false, error: "المسافة بين الصيانات غير صحيحة" };
  if (days === "bad" || days === 0) return { ok: false, error: "المدة بين الصيانات غير صحيحة" };
  if (lastKm === "bad") return { ok: false, error: "قراءة العداد عند آخر صيانة غير صحيحة" };
  if (km === null && days === null) return { ok: false, error: "حدد كل كم كيلومتر أو كل كم يوم" };
  const lastOn = t("last_done_on");
  if (lastOn && (!ISO_DATE.test(lastOn) || lastOn > opts.today)) return { ok: false, error: "تاريخ آخر صيانة غير صحيح" };
  if (km !== null && lastKm === null) return { ok: false, error: "أدخل قراءة العداد عند آخر صيانة" };
  if (days !== null && !lastOn) return { ok: false, error: "أدخل تاريخ آخر صيانة" };
  return {
    ok: true,
    values: {
      truck_id,
      service_name,
      interval_km: km,
      interval_days: days,
      last_done_odometer: lastKm,
      last_done_on: lastOn || null,
      is_active: get("is_active") !== "off",
    },
  };
}

/** Split a work order's lines into maintenance (5102) and tires (5103), as the posting does. */
export function splitByAccount(lines: { line_type: string; line_total_minor: number }[]): { maintenance: number; tires: number } {
  let maintenance = 0;
  let tires = 0;
  for (const l of lines) {
    if (l.line_type === "tire") tires += l.line_total_minor;
    else maintenance += l.line_total_minor;
  }
  return { maintenance, tires };
}
