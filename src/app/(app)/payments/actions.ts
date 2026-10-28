"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { parseIssuedChequeStatus, parseSupplierPayment } from "@/lib/payables";
import { describeDbError } from "@/lib/master-data-parse";

export type PaymentFormState = { error: string | null; done?: boolean; paymentId?: string; paymentNo?: number };

const fromForm = (formData: FormData) => (name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v : null;
};

function dbMessage(error: { code?: string; message: string }): string {
  if (["P0001", "23514", "42501"].includes(error.code ?? "")) return error.message;
  return describeDbError(error);
}

function refresh() {
  revalidatePath("/payments");
  revalidatePath("/payables");
  revalidatePath("/ledger", "layout");
}

/** Record a payment to a supplier; the database numbers it and posts it. */
export async function saveSupplierPayment(_prev: PaymentFormState, formData: FormData): Promise<PaymentFormState> {
  await requireRole(...FINANCE_ROLES);
  const parsed = parseSupplierPayment(fromForm(formData), { today: todayIso() });
  if (!parsed.ok) return { error: parsed.error };
  const supabase = await createClient();
  const { data, error } = await supabase.from("supplier_payments").insert(parsed.values).select("id, payment_no").single();
  if (error || !data) return { error: error ? dbMessage(error) : "تعذر حفظ الدفعة" };
  refresh();
  return { error: null, done: true, paymentId: data.id, paymentNo: data.payment_no };
}

/** Paid by our bank, bounced, or back to waiting: the ledger follows. */
export async function setIssuedChequeStatus(id: string, _prev: PaymentFormState, formData: FormData): Promise<PaymentFormState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { data: p } = await supabase.from("supplier_payments").select("paid_on, method").eq("id", id).maybeSingle();
  if (!p || p.method !== "cheque") return { error: "الشيك غير موجود" };
  const parsed = parseIssuedChequeStatus(fromForm(formData), { paidOn: p.paid_on, today: todayIso() });
  if (!parsed.ok) return { error: parsed.error };
  const { error } = await supabase.from("supplier_payments").update(parsed.values).eq("id", id);
  if (error) return { error: dbMessage(error) };
  refresh();
  return { error: null, done: true };
}

/** Delete a payment entered by mistake; its entries are reversed. */
export async function deleteSupplierPayment(id: string): Promise<PaymentFormState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { data, error } = await supabase.from("supplier_payments").delete().eq("id", id).select("id");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "تعذر حذف الدفعة" };
  refresh();
  return { error: null, done: true };
}
