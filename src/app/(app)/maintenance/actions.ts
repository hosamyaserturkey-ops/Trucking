"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES, STAFF_ROLES, TRIP_WRITERS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { afterFileSaved, attachFile, removeFile } from "@/lib/file-access";
import { describeDbError } from "@/lib/master-data-parse";
import {
  parseCancelReason,
  parseCloseWorkOrder,
  parseServiceSchedule,
  parseWorkOrder,
  parseWorkOrderLine,
} from "@/lib/work-orders";

export type WorkOrderFormState = { error: string | null; done?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fromForm = (formData: FormData) => (name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v : null;
};

function dbMessage(error: { code?: string; message: string }): string {
  if (error.code === "42501") return "لا تملك صلاحية هذا الإجراء";
  if (["P0001", "23514", "02000"].includes(error.code ?? "")) return error.message;
  return describeDbError(error);
}

function refresh(id: string | null, truckId?: string | null) {
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/schedules");
  if (id) revalidatePath(`/maintenance/${id}`);
  if (truckId) revalidatePath(`/trucks/${truckId}`, "layout");
  revalidatePath("/");
}

function refreshLedger() {
  revalidatePath("/payables");
  revalidatePath("/ledger", "layout");
  revalidatePath("/journal");
}

/** Open a work order; it goes to its own page to add the lines. */
export async function createWorkOrder(_prev: WorkOrderFormState, formData: FormData): Promise<WorkOrderFormState> {
  await requireRole(...STAFF_ROLES);
  const parsed = parseWorkOrder(fromForm(formData), { today: todayIso() });
  if (!parsed.ok) return { error: parsed.error };
  const supabase = await createClient();
  const { data, error } = await supabase.from("work_orders").insert(parsed.values).select("id").single();
  if (error || !data) return { error: error ? dbMessage(error) : "تعذر فتح أمر الصيانة" };
  refresh(data.id, parsed.values.truck_id);
  redirect(`/maintenance/${data.id}`);
}

/** Change an open order's header. */
export async function updateWorkOrder(id: string, _prev: WorkOrderFormState, formData: FormData): Promise<WorkOrderFormState> {
  await requireRole(...STAFF_ROLES);
  const parsed = parseWorkOrder(fromForm(formData), { today: todayIso() });
  if (!parsed.ok) return { error: parsed.error };
  const supabase = await createClient();
  const { data: before } = await supabase.from("work_orders").select("truck_id").eq("id", id).maybeSingle();
  const { data, error } = await supabase.from("work_orders").update(parsed.values).eq("id", id).select("id");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "أمر الصيانة غير موجود" };
  refresh(id, parsed.values.truck_id);
  if (before && before.truck_id !== parsed.values.truck_id) refresh(null, before.truck_id);
  return { error: null, done: true };
}

/** On a closed order only the paperwork changes: invoice number and notes. */
export async function updateWorkOrderNotes(id: string, _prev: WorkOrderFormState, formData: FormData): Promise<WorkOrderFormState> {
  await requireRole(...STAFF_ROLES);
  const get = fromForm(formData);
  const invoice_no = (get("invoice_no") ?? "").trim() || null;
  const notes = (get("notes") ?? "").trim() || null;
  if (invoice_no && invoice_no.length > 40) return { error: "رقم فاتورة الورشة طويل جداً" };
  if (notes && notes.length > 500) return { error: "الملاحظات طويلة جداً" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("work_orders").update({ invoice_no, notes }).eq("id", id).select("truck_id");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "أمر الصيانة غير موجود" };
  refresh(id, data[0].truck_id);
  return { error: null, done: true };
}

export async function addWorkOrderLine(id: string, _prev: WorkOrderFormState, formData: FormData): Promise<WorkOrderFormState> {
  await requireRole(...STAFF_ROLES);
  const parsed = parseWorkOrderLine(fromForm(formData));
  if (!parsed.ok) return { error: parsed.error };
  const supabase = await createClient();
  const { error } = await supabase.from("work_order_lines").insert({ ...parsed.values, work_order_id: id });
  if (error) return { error: dbMessage(error) };
  refresh(id);
  return { error: null, done: true };
}

export async function deleteWorkOrderLine(id: string, lineId: string): Promise<WorkOrderFormState> {
  await requireRole(...STAFF_ROLES);
  const supabase = await createClient();
  const { data, error } = await supabase.from("work_order_lines").delete().eq("id", lineId).eq("work_order_id", id).select("id");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "تعذر حذف البند" };
  refresh(id);
  return { error: null, done: true };
}

/** The manager or accountant closes the order with the workshop's invoice; it is posted then. */
export async function closeWorkOrder(id: string, _prev: WorkOrderFormState, formData: FormData): Promise<WorkOrderFormState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { data: wo } = await supabase.from("work_orders").select("opened_on, workshop_id, truck_id").eq("id", id).maybeSingle();
  if (!wo) return { error: "أمر الصيانة غير موجود" };
  const parsed = parseCloseWorkOrder(fromForm(formData), (n) => formData.getAll(n).filter((v): v is string => typeof v === "string"), {
    today: todayIso(),
    openedOn: wo.opened_on,
    hasWorkshop: !!wo.workshop_id,
  });
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.values;
  const { error } = await supabase.rpc("close_work_order", {
    p_work_order_id: id,
    p_closed_on: v.closed_on,
    p_payment_method: v.payment_method,
    p_invoice_no: v.invoice_no ?? undefined,
    p_voucher_no: v.voucher_no ?? undefined,
    p_notice_no: v.notice_no ?? undefined,
    p_schedule_ids: v.schedule_ids,
  });
  if (error) return { error: dbMessage(error) };
  refresh(id, wo.truck_id);
  refreshLedger();
  return { error: null, done: true };
}

/** Back to open to correct it: its entry is reversed. */
export async function reopenWorkOrder(id: string): Promise<WorkOrderFormState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { data, error } = await supabase.from("work_orders").update({ status: "open" }).eq("id", id).select("truck_id");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "أمر الصيانة غير موجود" };
  refresh(id, data[0].truck_id);
  refreshLedger();
  return { error: null, done: true };
}

export async function cancelWorkOrder(id: string, _prev: WorkOrderFormState, formData: FormData): Promise<WorkOrderFormState> {
  await requireRole(...STAFF_ROLES);
  const parsed = parseCancelReason(fromForm(formData));
  if (!parsed.ok) return { error: parsed.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("work_orders")
    .update({ status: "cancelled", cancel_reason: parsed.values.cancel_reason })
    .eq("id", id)
    .select("truck_id");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "أمر الصيانة غير موجود" };
  refresh(id, data[0].truck_id);
  return { error: null, done: true };
}

/** An open order opened by mistake goes, with its lines and invoice scan. */
export async function deleteWorkOrder(id: string): Promise<WorkOrderFormState> {
  await requireRole(...STAFF_ROLES);
  const supabase = await createClient();
  const { data, error } = await supabase.from("work_orders").delete().eq("id", id).select("truck_id, invoice_path");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "تعذر حذف أمر الصيانة" };
  await removeFile("work_order_invoice", data[0].invoice_path);
  refresh(null, data[0].truck_id);
  redirect("/maintenance");
}

/** Attach (or replace) the scan of the workshop's invoice. */
export async function attachWorkOrderInvoice(id: string, _prev: WorkOrderFormState, formData: FormData): Promise<WorkOrderFormState> {
  const profile = await requireRole(...STAFF_ROLES);
  const upload = (fromForm(formData)("receipt_upload") ?? "").trim();
  if (!upload) return { error: "اختر ملف الفاتورة (PDF أو صورة)" };
  if (!upload.startsWith(`tmp/truck-documents/${profile.user_id}/`) || upload.includes("..")) return { error: "ملف الفاتورة غير صالح" };
  const supabase = await createClient();
  const { data: before } = await supabase.from("work_orders").select("invoice_path, truck_id").eq("id", id).maybeSingle();
  if (!before) return { error: "أمر الصيانة غير موجود" };
  const attached = await attachFile("work_order_invoice", profile.user_id, upload);
  if (!attached.ok) return { error: attached.error };
  const { error } = await supabase.from("work_orders").update({ invoice_path: attached.path }).eq("id", id);
  if (error) {
    await removeFile("work_order_invoice", attached.path);
    return { error: dbMessage(error) };
  }
  await afterFileSaved("work_order_invoice", upload, before.invoice_path);
  refresh(id, before.truck_id);
  return { error: null, done: true };
}

/** Add or change a periodic service (manager and dispatcher). */
export async function saveServiceSchedule(id: string | null, _prev: WorkOrderFormState, formData: FormData): Promise<WorkOrderFormState> {
  await requireRole(...TRIP_WRITERS);
  if (id && !UUID.test(id)) return { error: "الصيانة غير موجودة" };
  const parsed = parseServiceSchedule(fromForm(formData), { today: todayIso() });
  if (!parsed.ok) return { error: parsed.error };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("service_schedules").update(parsed.values).eq("id", id)
    : await supabase.from("service_schedules").insert(parsed.values);
  if (error) {
    if (error.code === "23505") return { error: "هذه الصيانة موجودة لهذه الشاحنة" };
    return { error: dbMessage(error) };
  }
  refresh(null, parsed.values.truck_id);
  return { error: null, done: true };
}

export async function deleteServiceSchedule(id: string): Promise<WorkOrderFormState> {
  await requireRole(...TRIP_WRITERS);
  const supabase = await createClient();
  const { data, error } = await supabase.from("service_schedules").delete().eq("id", id).select("truck_id");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "تعذر حذف الصيانة" };
  refresh(null, data[0].truck_id);
  return { error: null, done: true };
}
