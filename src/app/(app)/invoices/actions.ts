"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { toLatinDigits } from "@/lib/money";
import { describeDbError } from "@/lib/master-data-parse";

export type InvoiceFormState = { error: string | null; done?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dbMessage(error: { code?: string; message: string }): string {
  if (["P0001", "23514", "42501", "P0002"].includes(error.code ?? "")) return error.message;
  return describeDbError(error);
}

/** Issue an invoice for the ticked loads; the database numbers it, adds tax and posts it. */
export async function issueInvoice(_prev: InvoiceFormState, formData: FormData): Promise<InvoiceFormState> {
  await requireRole(...FINANCE_ROLES);
  const client = String(formData.get("client_id") ?? "");
  if (!UUID.test(client)) return { error: "اختر الزبون" };
  const date = toLatinDigits(String(formData.get("invoice_date") ?? "").trim()) || todayIso();
  if (!ISO_DATE.test(date) || date > todayIso()) return { error: "تاريخ الفاتورة غير صحيح" };
  const trips = formData.getAll("trip_id").map(String).filter((id) => UUID.test(id));
  if (trips.length === 0) return { error: "اختر نقلة واحدة على الأقل" };
  const notes = String(formData.get("notes") ?? "").trim();
  if (notes.length > 500) return { error: "الملاحظات طويلة جداً" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_invoice", {
    p_client_id: client,
    p_invoice_date: date,
    p_trip_ids: trips,
    p_notes: notes || undefined,
  });
  if (error || !data) return { error: error ? dbMessage(error) : "تعذر إصدار الفاتورة" };
  revalidatePath("/", "layout");
  redirect(`/invoices/${data}?issued=1`);
}

/** Cancel an issued invoice with a reason; its loads can be invoiced again. */
export async function cancelInvoice(id: string, _prev: InvoiceFormState, formData: FormData): Promise<InvoiceFormState> {
  await requireRole(...FINANCE_ROLES);
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "اكتب سبب الإلغاء" };
  if (reason.length > 300) return { error: "السبب طويل جداً" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_invoice", { p_invoice_id: id, p_reason: reason });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/", "layout");
  return { error: null, done: true };
}
