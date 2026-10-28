import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Printer } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { amountInWords } from "@/lib/invoicing";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, formatDecimal } from "@/lib/format";
import { INVOICE_STATUS } from "@/lib/labels";
import { cancelInvoice } from "../actions";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { CancelInvoiceForm } from "@/components/invoice-forms";
import { JournalEntryCard } from "@/components/journal-entry-card";

export const metadata: Metadata = { title: "فاتورة" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ issued?: string }>;
}) {
  await requireRole(...FINANCE_ROLES);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { issued } = await searchParams;
  const supabase = await createClient();
  const [invRes, linesRes] = await Promise.all([
    supabase
      .from("invoices")
      .select("*, client:clients(id, name, tax_number)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("line_no"),
  ]);
  const inv = invRes.data;
  if (!inv) notFound();
  const lines = linesRes.data ?? [];
  const client = inv.client as { id: string; name: string; tax_number: string | null } | null;
  const st = INVOICE_STATUS[inv.status];

  return (
    <>
      <Link href="/invoices" className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        الفواتير
      </Link>
      <PageHeader
        title={`فاتورة رقم ${inv.invoice_no}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={st.tone}>{st.label}</Badge>
            {client?.name}
          </span>
        }
        action={
          <Link href={`/print/invoices/${inv.id}`} target="_blank" className={buttonClass("secondary")}>
            <Printer className="size-4" aria-hidden />
            طباعة الفاتورة
          </Link>
        }
      />
      <div className="flex flex-col gap-5">
        {issued ? (
          <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
            تم إصدار الفاتورة وترحيل قيدها.
          </p>
        ) : null}
        {inv.status === "cancelled" ? (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
            أُلغيت في <span className="num">{formatDateTime(inv.cancelled_at)}</span>: {inv.cancel_reason}
          </p>
        ) : null}

        <Card>
          <dl className="grid gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-3">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">تاريخ الفاتورة</dt>
              <dd className="num">{formatDate(inv.invoice_date)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">تاريخ الاستحقاق</dt>
              <dd className="num">{formatDate(inv.due_date)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">الفترة</dt>
              <dd className="num">
                {formatDate(inv.period_from)} – {formatDate(inv.period_to)}
              </dd>
            </div>
            {client ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted">كشف الزبون</dt>
                <dd>
                  <Link href={`/receivables/${client.id}`} className="text-primary hover:underline">
                    {client.name}
                  </Link>
                </dd>
              </div>
            ) : null}
            {inv.notes ? (
              <div className="flex justify-between gap-2 sm:col-span-2">
                <dt className="text-muted">ملاحظات</dt>
                <dd>{inv.notes}</dd>
              </div>
            ) : null}
          </dl>
        </Card>

        <Card>
          <CardHeader title="النقلات" subtitle={`${lines.length} نقلة · المبالغ بالدينار`} />
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>التاريخ</Th>
                <Th>رقم الإشارة</Th>
                <Th>مستند الزبون</Th>
                <Th>المسار</Th>
                <Th>الحمولة</Th>
                <Th className="text-end">المبلغ</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <Tr key={l.id}>
                  <Td className="num">{l.line_no}</Td>
                  <Td className="num whitespace-nowrap">{formatDate(l.load_date)}</Td>
                  <Td className="num whitespace-nowrap">
                    <span dir="ltr">{l.client_ref ?? "—"}</span>
                  </Td>
                  <Td className="num whitespace-nowrap">
                    <span dir="ltr">{l.client_doc_no ?? ""}</span>
                  </Td>
                  <Td className="whitespace-nowrap">{l.route}</Td>
                  <Td>
                    {l.cargo_description ?? "—"}
                    {l.cargo_weight_tons !== null ? <span className="num text-muted"> · {formatDecimal(l.cargo_weight_tons)} طن</span> : null}
                  </Td>
                  <Td className="num whitespace-nowrap text-end">
                    {formatMoney(l.amount_minor, "JOD", { withCurrency: false })}
                    {l.currency !== "JOD" ? <span className="block text-xs text-muted">{formatMoney(l.freight_minor, l.currency)}</span> : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <CardBody>
            <dl className="ms-auto grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted">المجموع قبل الضريبة</dt>
              <dd className="num text-end">{formatMoney(inv.subtotal_minor, "JOD")}</dd>
              <dt className="text-muted">ضريبة المبيعات ({formatDecimal(inv.vat_rate_pct, 0)}%)</dt>
              <dd className="num text-end">{formatMoney(inv.vat_minor, "JOD")}</dd>
              <dt className="font-semibold">الإجمالي</dt>
              <dd className="num text-end text-base font-bold">{formatMoney(inv.total_minor, "JOD")}</dd>
            </dl>
            <p className="mt-3 text-sm text-muted">{amountInWords(inv.total_minor)}</p>
          </CardBody>
        </Card>

        {inv.status === "issued" ? (
          <Card>
            <CardBody>
              <CancelInvoiceForm action={cancelInvoice.bind(null, inv.id)} />
            </CardBody>
          </Card>
        ) : null}

        <JournalEntryCard sourceType="invoice" sourceId={inv.id} />
      </div>
    </>
  );
}
