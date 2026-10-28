"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { parseChequeStatus, parseReceipt } from "@/lib/invoicing";
import { describeDbError } from "@/lib/master-data-parse";

export type ReceiptFormState = { error: string | null; done?: boolean; receiptId?: string; receiptNo?: number };

const fromForm = (formData: FormData) => (name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v : null;
};

function dbMessage(error: { code?: string; message: string }): string {
  if (["P0001", "23514", "42501"].includes(error.code ?? "")) return error.message;
  return describeDbError(error);
}

function refresh() {
  revalidatePath("/receipts");
  revalidatePath("/receivables", "layout");
  revalidatePath("/ledger", "layout");
}

/** Record a payment from a customer; the database numbers it and posts it. */
export async function saveReceipt(_prev: ReceiptFormState, formData: FormData): Promise<ReceiptFormState> {
  await requireRole(...FINANCE_ROLES);
  const parsed = parseReceipt(fromForm(formData), { today: todayIso() });
  if (!parsed.ok) return { error: parsed.error };
  const supabase = await createClient();
  const { data, error } = await supabase.from("client_receipts").insert(parsed.values).select("id, receipt_no").single();
  if (error || !data) return { error: error ? dbMessage(error) : "تعذر حفظ السند" };
  refresh();
  return { error: null, done: true, receiptId: data.id, receiptNo: data.receipt_no };
}

/** Deposited, cleared or bounced (or back in hand): the ledger follows. */
export async function setChequeStatus(id: string, _prev: ReceiptFormState, formData: FormData): Promise<ReceiptFormState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { data: r } = await supabase.from("client_receipts").select("received_on, method").eq("id", id).maybeSingle();
  if (!r || r.method !== "cheque") return { error: "الشيك غير موجود" };
  const parsed = parseChequeStatus(fromForm(formData), { receivedOn: r.received_on, today: todayIso() });
  if (!parsed.ok) return { error: parsed.error };
  const { error } = await supabase.from("client_receipts").update(parsed.values).eq("id", id);
  if (error) return { error: dbMessage(error) };
  refresh();
  return { error: null, done: true };
}

/** Delete a receipt entered by mistake; its entries are reversed. */
export async function deleteReceipt(id: string): Promise<ReceiptFormState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { data, error } = await supabase.from("client_receipts").delete().eq("id", id).select("id");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "تعذر حذف السند" };
  refresh();
  return { error: null, done: true };
}
