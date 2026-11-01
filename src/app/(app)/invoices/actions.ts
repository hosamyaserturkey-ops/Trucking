"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { toLatinDigits } from "@/lib/money";
import { describeDbError } from "@/lib/master-data-parse";
import { loadEinvoiceInput } from "@/lib/einvoice-data";
import { base64Utf8, buildEinvoiceXml, readJoFotaraResponse } from "@/lib/jofotara-xml";
import { jofotaraConfig, responseToStore, sendEinvoice, sha256Hex } from "@/lib/jofotara";
import type { Json } from "@/types/database";

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

export type EinvoiceState = { error: string | null; done?: boolean; message?: string };

/**
 * Send an invoice (or the credit note of a cancelled one) to JoFotara and
 * keep its answer. The same document (UUID and counter) is reused on retries.
 */
export async function submitEinvoice(invoiceId: string, kind: "invoice" | "credit_note"): Promise<EinvoiceState> {
  await requireRole(...FINANCE_ROLES);
  if (!UUID.test(invoiceId) || (kind !== "invoice" && kind !== "credit_note")) return { error: "طلب غير صحيح" };
  const config = jofotaraConfig();
  if (!config) return { error: "لم تُضبط بيانات الربط مع نظام الفوترة الوطني على الخادم (JOFOTARA_CLIENT_ID و JOFOTARA_SECRET_KEY)" };
  const supabase = await createClient();
  const { data: doc, error: prepError } = await supabase.rpc("einvoice_prepare", { p_invoice_id: invoiceId, p_kind: kind });
  if (prepError || !doc) return { error: prepError ? dbMessage(prepError) : "تعذر تجهيز الفاتورة الإلكترونية" };
  if (doc.status === "submitted") return { error: null, done: true, message: "أُرسلت وقُبلت سابقاً" };

  const { input, problems } = await loadEinvoiceInput(supabase, invoiceId, kind, doc);
  if (!input || problems.length) return { error: problems.join("\n") };
  const xml = buildEinvoiceXml(input);
  const sent = await sendEinvoice(base64Utf8(xml), config);
  const outcome = "error" in sent ? ({ accepted: false, message: sent.error } as const) : readJoFotaraResponse(sent.httpStatus, sent.body);
  const { error: recError } = await supabase.rpc("einvoice_record", {
    p_einvoice_id: doc.id,
    p_accepted: outcome.accepted,
    p_error: outcome.accepted ? undefined : outcome.message,
    p_einv_uuid: outcome.accepted ? (outcome.uuid ?? undefined) : undefined,
    p_einv_num: outcome.accepted ? (outcome.num ?? undefined) : undefined,
    p_einv_qr: outcome.accepted ? (outcome.qr ?? undefined) : undefined,
    p_response: ("error" in sent ? { error: sent.error } : responseToStore(sent.body)) as Json,
    p_xml_sha256: await sha256Hex(xml),
  });
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  if (recError) {
    // JoFotara answered but the answer could not be saved: say so plainly, it must not be lost.
    return { error: `ردّ نظام الفوترة (${outcome.accepted ? "مقبولة" : "مرفوضة"}) لكن تعذر حفظ الرد: ${dbMessage(recError)}. أعد الإرسال؛ سيُعرف أنها مرسلة.` };
  }
  if (!outcome.accepted) return { error: `رفض نظام الفوترة الوطني الفاتورة:\n${outcome.message}` };
  return { error: null, done: true, message: outcome.message ?? "قُبلت الفاتورة في نظام الفوترة الوطني" };
}
