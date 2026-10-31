import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { toLatinDigits } from "@/lib/money";
import { einvoiceProblems, lineDescription, spreadVat, type EinvoiceInput } from "@/lib/jofotara-xml";

type Client = SupabaseClient<Database>;
export type EinvoiceDoc = { id: string; icv: number; doc_no: string; issue_date: string; reason: string | null };

const digits = (s: string | null | undefined) => toLatinDigits(s ?? "").replace(/[\s-]/g, "");

/**
 * Everything the e-invoice file needs, from the invoice, its lines, the
 * customer and the company. `doc` is the einvoices row (UUID, counter,
 * number); without one, a preview is built with placeholders. `problems`
 * lists what must be fixed before it can be sent.
 */
export async function loadEinvoiceInput(
  supabase: Client,
  invoiceId: string,
  kind: "invoice" | "credit_note",
  doc: EinvoiceDoc | null,
): Promise<{ input: EinvoiceInput | null; problems: string[] }> {
  const [invRes, linesRes, companyRes, originalRes] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, invoice_no, invoice_date, status, vat_rate_pct, vat_minor, total_minor, subtotal_minor, notes, cancel_reason, period_from, period_to, client:clients(name, tax_number, phone, city)")
      .eq("id", invoiceId)
      .maybeSingle(),
    supabase
      .from("invoice_lines")
      .select("line_no, load_date, route, cargo_description, client_ref, client_doc_no, amount_minor, vat_minor")
      .eq("invoice_id", invoiceId)
      .order("line_no"),
    supabase.from("company_settings").select("company_name, tax_number, jofotara_income_source").maybeSingle(),
    kind === "credit_note"
      ? supabase.from("einvoices").select("id, doc_no, status").eq("invoice_id", invoiceId).eq("kind", "invoice").maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const inv = invRes.data;
  if (!inv) return { input: null, problems: ["الفاتورة غير موجودة"] };
  const client = inv.client as unknown as { name: string; tax_number: string | null; phone: string | null; city: string | null } | null;
  const lines = linesRes.data ?? [];
  const company = companyRes.data;
  const amounts = lines.map((l) => l.amount_minor);
  const vats = lines.every((l) => l.vat_minor !== null) ? lines.map((l) => l.vat_minor as number) : spreadVat(amounts, inv.vat_minor);

  const input: EinvoiceInput = {
    kind,
    docNo: doc?.doc_no ?? (kind === "credit_note" ? `R-${inv.invoice_no}` : String(inv.invoice_no)),
    uuid: doc?.id ?? "00000000-0000-0000-0000-000000000000",
    issueDate: doc?.issue_date ?? inv.invoice_date,
    icv: doc?.icv ?? 0,
    note: inv.notes ?? `خدمات نقل عن الفترة ${inv.period_from} إلى ${inv.period_to}`,
    seller: {
      taxNumber: digits(company?.tax_number),
      name: (company?.company_name ?? "").trim(),
      incomeSource: digits(company?.jofotara_income_source),
    },
    buyer: { taxNumber: digits(client?.tax_number), name: (client?.name ?? "").trim(), phone: client?.phone ?? null, city: client?.city ?? null },
    vatRatePct: Number(inv.vat_rate_pct),
    exempt: Number(inv.vat_rate_pct) === 0,
    lines: lines.map((l, i) => ({ description: lineDescription(l), amountMinor: l.amount_minor, vatMinor: vats[i] })),
  };
  const problems = einvoiceProblems(input);
  if (input.lines.reduce((s, l) => s + l.vatMinor, 0) !== inv.vat_minor) problems.push("ضريبة السطور لا تساوي ضريبة الفاتورة");
  if (kind === "credit_note") {
    const original = originalRes.data;
    if (!original || original.status !== "submitted") problems.push("الفاتورة الأصلية لم تُقبل في نظام الفوترة بعد");
    else input.original = { docNo: original.doc_no, uuid: original.id, totalMinor: inv.total_minor };
    input.reason = doc?.reason ?? inv.cancel_reason;
    if (!input.reason) problems.push("سبب الإرجاع مطلوب");
  }
  return { input, problems };
}
