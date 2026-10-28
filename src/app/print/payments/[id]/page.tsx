import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { amountInWords } from "@/lib/invoicing";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { ISSUED_CHEQUE_STATUS, SUPPLIER_PAYMENT_METHOD } from "@/lib/labels";
import { PrintButton } from "@/components/print-button";

export const metadata: Metadata = { title: "سند صرف" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A5 landscape payment voucher (سند صرف) to a supplier, to print or save as PDF.
export default async function PaymentPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole(...FINANCE_ROLES);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [pRes, settingsRes] = await Promise.all([
    supabase.from("supplier_payments").select("*, supplier:suppliers(name)").eq("id", id).maybeSingle(),
    supabase.from("company_settings").select("company_name, address, phone").maybeSingle(),
  ]);
  const p = pRes.data;
  if (!p) notFound();
  const company = settingsRes.data;
  const row = (label: string, value: React.ReactNode) => (
    <p className="flex gap-2 border-b border-dotted border-border py-1.5">
      <span className="w-40 shrink-0 text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </p>
  );

  return (
    <main className="mx-auto max-w-[210mm] bg-surface p-6 text-[13px] leading-relaxed print:max-w-none print:p-0">
      <style>{`@page { size: A5 landscape; margin: 10mm; }`}</style>
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton />
      </div>
      <header className="flex items-start justify-between gap-4 border-b-2 border-text pb-3">
        <div>
          <p className="text-lg font-bold">{company?.company_name ?? "شركة النقل"}</p>
          {company?.address ? <p className="text-xs">{company.address}</p> : null}
          {company?.phone ? (
            <p className="text-xs">
              هاتف: <span dir="ltr">{company.phone}</span>
            </p>
          ) : null}
        </div>
        <div className="text-start">
          <h1 className="text-xl font-bold">سند صرف</h1>
          {p.voucher_no ? (
            <p>
              رقم السند: <span className="num font-bold" dir="ltr">{p.voucher_no}</span>
            </p>
          ) : null}
          <p>
            رقم الدفعة: <span className="num">{p.payment_no}</span>
          </p>
          <p>
            التاريخ: <span className="num">{formatDate(p.paid_on)}</span>
          </p>
        </div>
      </header>

      <section className="mt-3">
        {row("اصرفوا للسادة", (p.supplier as { name: string } | null)?.name)}
        {row("مبلغ وقدره", <span className="num">{formatMoney(p.amount_minor, "JOD")}</span>)}
        {row("المبلغ كتابةً", amountInWords(p.amount_minor))}
        {row(
          "طريقة الدفع",
          p.method === "cheque" ? (
            <>
              شيك رقم <span className="num" dir="ltr">{p.cheque_no}</span>
              {p.cheque_bank ? ` على ${p.cheque_bank}` : ""} يستحق في <span className="num">{formatDate(p.cheque_due_date)}</span>
              {p.cheque_status && p.cheque_status !== "issued" ? ` (${ISSUED_CHEQUE_STATUS[p.cheque_status].label})` : ""}
            </>
          ) : (
            <>
              {SUPPLIER_PAYMENT_METHOD[p.method]}
              {p.reference_no ? (
                <>
                  {" "}
                  — رقم <span className="num" dir="ltr">{p.reference_no}</span>
                </>
              ) : null}
            </>
          ),
        )}
        {row("وذلك عن", p.notes ?? "دفعة على الحساب")}
      </section>

      <footer className="mt-10 grid grid-cols-3 gap-8 text-sm">
        <p className="border-t border-text pt-2">المحاسب: {profile.full_name || ""}</p>
        <p className="border-t border-text pt-2">المدير:</p>
        <p className="border-t border-text pt-2">المستلم:</p>
      </footer>
      <p className="mt-4 text-[10px] text-muted">طُبع في {formatDateTime(new Date().toISOString())}</p>
    </main>
  );
}
