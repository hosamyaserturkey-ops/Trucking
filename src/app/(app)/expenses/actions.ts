"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { parseOfficeExpense } from "@/lib/expense-parse";
import { afterFileSaved, attachFile, removeFile } from "@/lib/file-access";
import { describeDbError } from "@/lib/master-data-parse";

export type OfficeExpenseState = { error: string | null };

const fromForm = (formData: FormData) => (name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v : null;
};

function dbMessage(error: { code?: string; message: string }): string {
  if (error.code === "P0001" || error.code === "23514" || error.code === "42501") return error.message;
  return describeDbError(error);
}

/** Record (id null) or correct an office expense: a truck's cost or general overhead. Counts at once. */
export async function saveOfficeExpense(id: string | null, _prev: OfficeExpenseState, formData: FormData): Promise<OfficeExpenseState> {
  const profile = await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { data: categories } = await supabase.from("expense_categories").select("id").eq("is_active", true);
  const parsed = parseOfficeExpense(fromForm(formData), {
    userId: profile.user_id,
    today: todayIso(),
    allowedCategoryIds: (categories ?? []).map((c) => c.id),
  });
  if (!parsed.ok) return { error: parsed.error };
  const { receipt_upload, ...row } = parsed.values;

  let receipt_path: string | null = null;
  if (receipt_upload) {
    const attached = await attachFile("expense_receipt", profile.user_id, receipt_upload);
    if (!attached.ok) return { error: attached.error };
    receipt_path = attached.path;
  }

  if (id) {
    // Driver submissions are reviewed in Approvals, not edited here; settled rows are frozen.
    const { data: old } = await supabase.from("expenses").select("receipt_path, status").eq("id", id).maybeSingle();
    if (old?.status === "submitted") return { error: "هذا المصروف بانتظار الموافقة؛ راجعه من شاشة الموافقات" };
    const update = receipt_path ? { ...row, receipt_path } : row;
    const { data, error } = await supabase
      .from("expenses")
      .update(update)
      .eq("id", id)
      .eq("status", "approved")
      .is("settlement_id", null)
      .select("id");
    if (error || !data?.length) {
      await removeFile("expense_receipt", receipt_path);
      return { error: error ? dbMessage(error) : "لا يمكن تعديل هذا المصروف" };
    }
    await afterFileSaved("expense_receipt", receipt_upload, receipt_path ? old?.receipt_path : null);
  } else {
    const { error } = await supabase.from("expenses").insert({ ...row, receipt_path, status: "approved" });
    if (error) {
      await removeFile("expense_receipt", receipt_path);
      return { error: dbMessage(error) };
    }
    await afterFileSaved("expense_receipt", receipt_upload, null);
  }

  revalidatePath("/", "layout");
  redirect("/expenses?saved=1");
}

/** Delete an unsettled office expense; its receipt is deleted too. */
export async function deleteOfficeExpense(id: string): Promise<OfficeExpenseState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", id)
    .is("settlement_id", null)
    .eq("status", "approved")
    .select("id, receipt_path");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "لا يمكن حذف هذا المصروف" };
  await removeFile("expense_receipt", data[0].receipt_path);
  revalidatePath("/", "layout");
  redirect("/expenses");
}
