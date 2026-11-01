"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { addDays, todayIso } from "@/lib/date-range";
import { parseManualLine, parseStatementForm, suggestMatches } from "@/lib/bank";
import { describeDbError } from "@/lib/master-data-parse";

export type BankFormState = { error: string | null; done?: boolean; message?: string };

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

function refresh(id?: string) {
  revalidatePath("/bank");
  if (id) revalidatePath(`/bank/${id}`);
  revalidatePath("/ledger", "layout");
  revalidatePath("/journal");
}

/** Enter a statement with the lines read from the bank's file (or none, to type them). */
export async function createBankStatement(_prev: BankFormState, formData: FormData): Promise<BankFormState> {
  await requireRole(...FINANCE_ROLES);
  const parsed = parseStatementForm(fromForm(formData), { today: todayIso() });
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.values;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bank_statement_create", {
    p_account_id: v.account_id,
    p_period_from: v.period_from,
    p_period_to: v.period_to,
    p_opening_minor: v.opening_minor,
    p_lines: v.lines,
    p_source_name: v.source_name ?? undefined,
    p_notes: v.notes ?? undefined,
  });
  if (error || !data) return { error: error ? dbMessage(error) : "تعذر حفظ الكشف" };
  refresh();
  redirect(`/bank/${data}`);
}

export async function addBankLine(id: string, _prev: BankFormState, formData: FormData): Promise<BankFormState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { data: st } = await supabase.from("bank_statements").select("period_from, period_to").eq("id", id).maybeSingle();
  if (!st) return { error: "الكشف غير موجود" };
  const parsed = parseManualLine(fromForm(formData), { from: st.period_from, to: st.period_to });
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.values;
  const { error } = await supabase.rpc("bank_statement_add_line", {
    p_statement_id: id,
    p_txn_date: v.txn_date,
    p_amount_minor: v.amount_minor,
    p_description: v.description,
    p_reference: v.reference ?? undefined,
  });
  if (error) return { error: dbMessage(error) };
  refresh(id);
  return { error: null, done: true };
}

export async function deleteBankLine(id: string, lineId: string): Promise<BankFormState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { error } = await supabase.rpc("bank_statement_delete_line", { p_line_id: lineId });
  if (error) return { error: dbMessage(error) };
  refresh(id);
  return { error: null, done: true };
}

/** Match the ticked lines of both sides; their totals must be equal. */
export async function matchBankLines(id: string, _prev: BankFormState, formData: FormData): Promise<BankFormState> {
  await requireRole(...FINANCE_ROLES);
  const ids = (name: string) => formData.getAll(name).filter((v): v is string => typeof v === "string" && UUID.test(v));
  const bank = ids("bank_id");
  const book = ids("book_id");
  if (bank.length + book.length < 2) return { error: "اختر حركة من الكشف وحركة من الدفاتر على الأقل" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("bank_match", { p_statement_id: id, p_bank_line_ids: bank, p_journal_line_ids: book });
  if (error) return { error: dbMessage(error) };
  refresh(id);
  return { error: null, done: true, message: "تمت المطابقة" };
}

/** Match whatever pairs up one to one: same amount within 10 days, a matching cheque or notice number first. */
export async function autoMatchBank(id: string): Promise<BankFormState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { data: st } = await supabase.from("bank_statements").select("account_id, period_from, period_to, status").eq("id", id).maybeSingle();
  if (!st) return { error: "الكشف غير موجود" };
  if (st.status !== "open") return { error: "الكشف مغلق" };
  const [bankRes, bookRes] = await Promise.all([
    supabase.from("bank_statement_lines").select("id, txn_date, amount_minor, description, reference").eq("statement_id", id).is("match_id", null).limit(3000),
    supabase
      .from("bank_book_lines_v")
      .select("id, entry_date, amount_minor, cheque_no, notice_no, voucher_no, reference_no, receipt_no, payment_no")
      .eq("account_id", st.account_id)
      .is("match_id", null)
      .eq("is_opening", false)
      .eq("is_cancelled", false)
      .gte("entry_date", addDays(st.period_from, -60))
      .lte("entry_date", addDays(st.period_to, 31))
      .limit(3000),
  ]);
  const pairs = suggestMatches(
    (bankRes.data ?? []).map((l) => ({ id: l.id, date: l.txn_date, amount: l.amount_minor, text: `${l.description} ${l.reference ?? ""}` })),
    (bookRes.data ?? []).map((l) => ({
      id: l.id!,
      date: l.entry_date!,
      amount: l.amount_minor!,
      refs: [l.cheque_no, l.notice_no, l.voucher_no, l.reference_no],
    })),
  );
  if (pairs.length === 0) return { error: null, done: true, message: "لم أجد حركات متطابقة تلقائياً" };
  const { data, error } = await supabase.rpc("bank_match_pairs", { p_statement_id: id, p_pairs: pairs });
  if (error) return { error: dbMessage(error) };
  refresh(id);
  return { error: null, done: true, message: `طوبقت ${data ?? pairs.length} حركة تلقائياً؛ راجعها` };
}

export async function unmatchBank(id: string, matchId: string): Promise<BankFormState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { error } = await supabase.rpc("bank_unmatch", { p_match_id: matchId });
  if (error) return { error: dbMessage(error) };
  refresh(id);
  return { error: null, done: true };
}

/** Post a bank line the books do not have (charges, interest) and match it. */
export async function postBankLine(id: string, lineId: string, _prev: BankFormState, formData: FormData): Promise<BankFormState> {
  await requireRole(...FINANCE_ROLES);
  const get = fromForm(formData);
  const account = (get("account_id") ?? "").trim();
  const truck = (get("truck_id") ?? "").trim();
  const description = (get("description") ?? "").replace(/\s+/g, " ").trim();
  if (!UUID.test(account)) return { error: "اختر الحساب المقابل" };
  if (truck && !UUID.test(truck)) return { error: "الشاحنة غير صحيحة" };
  if (description.length > 200) return { error: "البيان طويل جداً" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("bank_post_line", {
    p_line_id: lineId,
    p_account_id: account,
    p_description: description || undefined,
    p_truck_id: truck || undefined,
  });
  if (error) return { error: dbMessage(error) };
  refresh(id);
  return { error: null, done: true };
}

export async function closeBankStatement(id: string): Promise<BankFormState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { error } = await supabase.rpc("bank_statement_close", { p_statement_id: id });
  if (error) return { error: dbMessage(error) };
  refresh(id);
  return { error: null, done: true };
}

export async function reopenBankStatement(id: string): Promise<BankFormState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { error } = await supabase.rpc("bank_statement_reopen", { p_statement_id: id });
  if (error) return { error: dbMessage(error) };
  refresh(id);
  return { error: null, done: true };
}

export async function deleteBankStatement(id: string): Promise<BankFormState> {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { error } = await supabase.rpc("bank_statement_delete", { p_statement_id: id });
  if (error) return { error: dbMessage(error) };
  refresh();
  redirect("/bank");
}
