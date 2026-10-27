"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { parseApproval, parseRejection } from "@/lib/advances";
import { parseFuelApproval } from "@/lib/fuel";
import { describeDbError } from "@/lib/master-data-parse";

export type ReviewState = { error: string | null; done?: "approved" | "rejected" };

const fromForm = (formData: FormData) => (name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v : null;
};

function dbMessage(error: { code?: string; message: string }): string {
  if (error.code === "P0001" || error.code === "23514" || error.code === "42501") return error.message;
  return describeDbError(error);
}

function refresh() {
  revalidatePath("/approvals");
  revalidatePath("/advances", "layout");
  revalidatePath("/");
}

/** Approve a submitted expense, after optionally fixing its category, amount or rate. */
export async function approveExpense(id: string, _prev: ReviewState, formData: FormData): Promise<ReviewState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const [{ data: expense }, { data: categories }] = await Promise.all([
    supabase.from("expenses").select("currency, status").eq("id", id).maybeSingle(),
    supabase.from("expense_categories").select("id").eq("is_active", true),
  ]);
  if (!expense) return { error: "المصروف غير موجود" };
  if (expense.status !== "submitted") return { error: "تمت مراجعة هذا المصروف مسبقاً" };

  const parsed = parseApproval(fromForm(formData), {
    currency: expense.currency,
    allowedCategoryIds: (categories ?? []).map((c) => c.id),
  });
  if (!parsed.ok) return { error: parsed.error };

  // The database stamps reviewed_by / reviewed_at and only lets finance roles do this.
  const { data, error } = await supabase
    .from("expenses")
    .update({ ...parsed.values, status: "approved" })
    .eq("id", id)
    .eq("status", "submitted")
    .select("id");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "تمت مراجعة هذا المصروف مسبقاً" };
  refresh();
  return { error: null, done: "approved" };
}

/** Reject a submitted expense; the driver sees the reason. */
export async function rejectExpense(id: string, _prev: ReviewState, formData: FormData): Promise<ReviewState> {
  await requireRole(...FINANCE_ROLES);
  const parsed = parseRejection(fromForm(formData));
  if (!parsed.ok) return { error: parsed.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .update({ status: "rejected", rejection_reason: parsed.values.rejection_reason })
    .eq("id", id)
    .eq("status", "submitted")
    .select("id");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "تمت مراجعة هذا المصروف مسبقاً" };
  refresh();
  return { error: null, done: "rejected" };
}

/** Approve a driver's or dispatcher's fill-up, after optionally fixing liters, amount, odometer or full tank. */
export async function approveFillup(id: string, _prev: ReviewState, formData: FormData): Promise<ReviewState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { data: fill } = await supabase.from("fuel_fillups").select("currency, status").eq("id", id).maybeSingle();
  if (!fill) return { error: "التعبئة غير موجودة" };
  if (fill.status !== "submitted") return { error: "تمت مراجعة هذه التعبئة مسبقاً" };
  const parsed = parseFuelApproval(fromForm(formData), fill.currency);
  if (!parsed.ok) return { error: parsed.error };

  // The database re-checks tank size and odometer order, and stamps the reviewer.
  const { data, error } = await supabase
    .from("fuel_fillups")
    .update({ ...parsed.values, status: "approved" })
    .eq("id", id)
    .eq("status", "submitted")
    .select("id");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "تمت مراجعة هذه التعبئة مسبقاً" };
  refresh();
  return { error: null, done: "approved" };
}

/** Reject a fill-up; the driver sees the reason. */
export async function rejectFillup(id: string, _prev: ReviewState, formData: FormData): Promise<ReviewState> {
  await requireRole(...FINANCE_ROLES);
  const parsed = parseRejection(fromForm(formData));
  if (!parsed.ok) return { error: parsed.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fuel_fillups")
    .update({ status: "rejected", rejection_reason: parsed.values.rejection_reason })
    .eq("id", id)
    .eq("status", "submitted")
    .select("id");
  if (error) return { error: dbMessage(error) };
  if (!data?.length) return { error: "تمت مراجعة هذه التعبئة مسبقاً" };
  refresh();
  return { error: null, done: "rejected" };
}
