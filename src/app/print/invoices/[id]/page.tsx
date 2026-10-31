import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { amountInWords } from "@/lib/invoicing";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, formatDecimal } from "@/lib/format";
import { PrintButton } from "@/components/print-button";
import { EinvoiceQr } from "@/components/einvoice-qr";

export const metadata: Metadata = { title: "فاتورة" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CELL = "border border-border px-2 py-1";

// A4 tax invoice (فاتورة ضريبية), to print or save as PDF.
export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(...FINANCE_ROLES);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [invRes, linesRes, settingsRes, einvRes] = await Promise.all([
    supabase.from("invoices").select("*, client:clients(name, tax_number, address, city, phone)").eq("id", id).maybeSingle(),
    supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("line_no"),
    supabase.from("company_settings").select("company_name, tax_number, address, phone").maybeSingle(),
    supabase.from("einvoices").select("id, doc_no, einv_num, einv_qr, submitted_at").eq("invoice_id", id).eq("kind", "invoice").eq("status", "submitted").maybeSingle(),
  ]);
  const einv = einvRes.data;
  const inv = invRes.data;
  if (!inv) notFound();
  const lines = linesRes.data ?? [];
  const company = settingsRes.data;
  const client = inv.client as { name: string; tax_number: string | null; address: string | null; city: string | null; phone: string | null } | null;
  const tons = lines.reduce((s, l) => s + Number(l.cargo_weight_tons ?? 0), 0);

  return (
    <main className="mx-auto max-w-[210mm] bg-surface p-6 text-[12px] leading-relaxed print:max-w-none print:p-0">
      <style>{`@page { size: A4; margin: 12mm; } @media print { thead { display: table-header-group; } tr { break-inside: avoid; } }`}</style>
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton />
      </div>
      {inv.status === "cancelled" ? (
        <p className="mb-3 border-2 border-danger p-2 text-center text-lg font-bold text-danger">فاتورة ملغاة — {inv.cancel_reason}</p>
      ) : null}

      <header className="flex items-start justify-between gap-4 border-b-2 border-text pb-3">
        <div>
          <p className="text-lg font-bold">{company?.company_name ?? "شركة النقل"}</p>
          {company?.address ? <p>{company.address}</p> : null}
          {company?.phone ? (
            <p>
              هاتف: <span dir="ltr">{company.phone}</span>
            </p>
          ) : null}
          {company?.tax_number ? (
            <p>
              الرقم الضريبي: <span className="num">{company.tax_number}</span>
            </p>
          ) : null}
        </div>
        <div className="text-start">
          <h1 className="text-xl font-bold">فاتورة ضريبية</h1>
          <p>
            رقم الفاتورة: <span className="num font-bold">{inv.invoice_no}</span>
          </p>
          <p>
            التاريخ: <span className="num">{formatDate(inv.invoice_date)}</span>
          </p>
          <p>
            تاريخ الاستحقاق: <span className="num">{formatDate(inv.due_date)}</span>
          </p>
        </div>
      </header>

      <section className="mt-3 grid grid-cols-2 gap-4 border-b border-border pb-3">
        <div>
          <p className="text-muted">العميل</p>
          <p className="font-bold">{client?.name}</p>
          {client?.address || client?.city ? <p>{[client.address, client.city].filter(Boolean).join("، ")}</p> : null}
          {client?.tax_number ? (
            <p>
              الرقم الضريبي: <span className="num">{client.tax_number}</span>
            </p>
          ) : null}
        </div>
        <div>
          <p className="text-muted">عن نقلات الفترة</p>
          <p className="num">
            من {formatDate(inv.period_from)} إلى {formatDate(inv.period_to)}
          </p>
          {inv.notes ? <p>{inv.notes}</p> : null}
        </div>
      </section>

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="bg-surface-2">
            <th className={`${CELL} text-start`}>#</th>
            <th className={`${CELL} text-start`}>التاريخ</th>
            <th className={`${CELL} text-start`}>رقم الإشارة</th>
            <th className={`${CELL} text-start`}>مستند الزبون</th>
            <th className={`${CELL} text-start`}>المسار</th>
            <th className={`${CELL} text-start`}>الحمولة</th>
            <th className={`${CELL} text-end`}>الوزن (طن)</th>
            <th className={`${CELL} text-end`}>المبلغ (د.أ)</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td className={`${CELL} num`}>{l.line_no}</td>
              <td className={`${CELL} num whitespace-nowrap`}>{formatDate(l.load_date)}</td>
              <td className={`${CELL} num whitespace-nowrap`}>
                <span dir="ltr">{l.client_ref ?? ""}</span>
              </td>
              <td className={`${CELL} num`}>
                <span dir="ltr">{l.client_doc_no ?? ""}</span>
              </td>
              <td className={CELL}>{l.route}</td>
              <td className={CELL}>{l.cargo_description ?? ""}</td>
              <td className={`${CELL} num text-end`}>{l.cargo_weight_tons !== null ? formatDecimal(l.cargo_weight_tons) : ""}</td>
              <td className={`${CELL} num whitespace-nowrap text-end`}>
                {formatMoney(l.amount_minor, "JOD", { withCurrency: false })}
                {l.currency !== "JOD" ? <span className="block text-[10px] text-muted">{formatMoney(l.freight_minor, l.currency)}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className={CELL} colSpan={6}>
              عدد النقلات: <span className="num">{lines.length}</span>
            </td>
            <td className={`${CELL} num text-end`}>{tons ? formatDecimal(tons) : ""}</td>
            <td className={CELL} />
          </tr>
        </tfoot>
      </table>

      <div className="mt-4 flex justify-end">
        <table className="w-72 border-collapse">
          <tbody>
            <tr>
              <td className={CELL}>المجموع قبل الضريبة</td>
              <td className={`${CELL} num text-end`}>{formatMoney(inv.subtotal_minor, "JOD")}</td>
            </tr>
            <tr>
              <td className={CELL}>ضريبة المبيعات ({formatDecimal(inv.vat_rate_pct, 0)}%)</td>
              <td className={`${CELL} num text-end`}>{formatMoney(inv.vat_minor, "JOD")}</td>
            </tr>
            <tr className="bg-surface-2 font-bold">
              <td className={CELL}>الإجمالي</td>
              <td className={`${CELL} num text-end`}>{formatMoney(inv.total_minor, "JOD")}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 font-semibold">{amountInWords(inv.total_minor)}</p>

      {einv ? (
        <section className="mt-4 flex items-center gap-4 border border-border p-3 break-inside-avoid">
          {einv.einv_qr ? <EinvoiceQr text={einv.einv_qr} size={110} /> : null}
          <div className="text-[11px]">
            <p className="font-semibold">فاتورة مُرسلة إلى نظام الفوترة الوطني الإلكتروني (جوفوترة)</p>
            {einv.einv_num ? (
              <p>
                رقم النظام: <span className="num" dir="ltr">{einv.einv_num}</span>
              </p>
            ) : null}
            <p>
              المعرّف: <span className="num" dir="ltr">{einv.id}</span>
            </p>
            <p>
              قُبلت في: <span className="num">{formatDateTime(einv.submitted_at)}</span>
            </p>
          </div>
        </section>
      ) : null}

      <footer className="mt-12 grid grid-cols-2 gap-10 text-sm">
        <p className="border-t border-text pt-2">المحاسب:</p>
        <p className="border-t border-text pt-2">استلمت الفاتورة (العميل):</p>
      </footer>
      <p className="mt-4 text-[10px] text-muted">طُبعت في {formatDateTime(new Date().toISOString())}</p>
    </main>
  );
}
