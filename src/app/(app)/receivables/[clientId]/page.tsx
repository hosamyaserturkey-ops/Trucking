import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Printer } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { todayIso } from "@/lib/date-range";
import { filterQuery, statementFilter } from "@/lib/ledger";
import { loadClientStatement } from "@/lib/receivables-data";
import { formatMoney } from "@/lib/money";
import { formatDate, formatInt } from "@/lib/format";
import { saveReceipt } from "@/app/(app)/receipts/actions";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { ExportButton } from "@/components/export-button";
import { Amount, Balance, StatementFilters } from "@/components/ledger-bits";
import { ReceiptForm } from "@/components/receipt-forms";

export const metadata: Metadata = { title: "كشف حساب زبون" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A customer's statement: invoices, receipts and bounced cheques with the running balance. */
export default async function ClientStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireRole(...FINANCE_ROLES);
  const { clientId } = await params;
  if (!UUID.test(clientId)) notFound();
  const sp = await searchParams;
  // This year so far by default.
  const f = statementFilter(sp.from && sp.to ? sp : { from: `${todayIso().slice(0, 4)}-01-01`, to: todayIso() });
  const st = await loadClientStatement(clientId, f);
  if (!st) notFound();
  const b = st.balance;

  return (
    <>
      <Link href="/receivables" className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        ذمم العملاء
      </Link>
      <PageHeader
        title={`كشف حساب: ${st.client.name}`}
        subtitle={`من ${formatDate(f.from)} إلى ${formatDate(f.to)} · مدة السداد ${formatInt(st.client.payment_terms_days)} يوم${st.client.vat_exempt ? " · معفى من الضريبة" : ""}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link href={`/print/receivables/${clientId}?${filterQuery(f)}`} target="_blank" className={buttonClass("secondary")}>
              <Printer className="size-4" aria-hidden />
              طباعة الكشف
            </Link>
            {b?.unbilled_loads ? (
              <Link href={`/invoices/new?client=${clientId}`} className={buttonClass("primary")}>
                فوترة {formatInt(b.unbilled_loads)} نقلة
              </Link>
            ) : null}
          </div>
        }
      />
      <StatementFilters action={`/receivables/${clientId}`} filter={f} />

      <div className="flex flex-col gap-5">
        <StatGrid>
          <Stat label="الرصيد الآن" value={<Balance minor={b?.balance_minor ?? 0} />} />
          <Stat label="مستحق متأخر" value={formatMoney(b?.overdue_minor ?? 0, "JOD")} tone={b?.overdue_minor ? "danger" : "success"} />
          <Stat label="شيكات برسم التحصيل" value={formatMoney(b?.cheques_pending_minor ?? 0, "JOD")} />
          <Stat label="نقلات غير مفوترة" value={formatMoney(b?.unbilled_minor ?? 0, "JOD")} hint={`${formatInt(b?.unbilled_loads ?? 0)} نقلة`} />
        </StatGrid>

        <Card>
          <CardHeader title="الحركات" subtitle="الفواتير مدينة، والمقبوضات دائنة، والشيك المرتجع مدين من جديد" action={<ExportButton tableId="client-statement" file="customer-statement" title={`كشف حساب ${st.client.name} من ${formatDate(f.from)} إلى ${formatDate(f.to)} · الرصيد موجب = مدين، سالب = دائن`} />} />
          {st.lines.length === 0 && st.opening === 0 ? (
            <EmptyState>لا توجد حركات في هذه الفترة.</EmptyState>
          ) : (
            <Table id="client-statement">
              <thead>
                <tr>
                  <Th>التاريخ</Th>
                  <Th>البيان</Th>
                  <Th>التفاصيل</Th>
                  <Th className="text-end">مدين</Th>
                  <Th className="text-end">دائن</Th>
                  <Th className="text-end">الرصيد</Th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-surface-2/60">
                  <Td className="num whitespace-nowrap">{formatDate(f.from)}</Td>
                  <Td className="font-medium">رصيد أول المدة</Td>
                  <td className="border-b border-border" colSpan={3} />
                  <Td className="text-end font-medium">
                    <Balance minor={st.opening} />
                  </Td>
                </tr>
                {st.lines.map((l) => (
                  <Tr key={l.key} className={l.kind === "bounced" ? "text-danger" : ""}>
                    <Td className="num whitespace-nowrap">{formatDate(l.date)}</Td>
                    <Td className="whitespace-nowrap">
                      {l.kind === "opening" ? (
                        l.description
                      ) : (
                        <Link href={l.kind === "invoice" ? `/invoices/${l.docId}` : `/print/receipts/${l.docId}`} className="hover:underline">
                          {l.description}
                        </Link>
                      )}
                    </Td>
                    <Td className="text-xs text-muted">{l.details ?? ""}</Td>
                    <Td className="num whitespace-nowrap text-end">
                      <Amount minor={l.debit_minor} />
                    </Td>
                    <Td className="num whitespace-nowrap text-end">
                      <Amount minor={l.credit_minor} />
                    </Td>
                    <Td className="text-end">
                      <Balance minor={l.balance_minor} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2 font-semibold">
                  <td className="border-b border-border px-3 py-2" colSpan={3}>
                    المجموع والرصيد في {formatDate(f.to)}
                  </td>
                  <td className="num whitespace-nowrap border-b border-border px-3 py-2 text-end">
                    <Amount minor={st.debit} />
                  </td>
                  <td className="num whitespace-nowrap border-b border-border px-3 py-2 text-end">
                    <Amount minor={st.credit} />
                  </td>
                  <td className="border-b border-border px-3 py-2 text-end">
                    <Balance minor={st.closing} />
                  </td>
                </tr>
              </tfoot>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="قبض دفعة من هذا الزبون" />
          <CardBody>
            <ReceiptForm action={saveReceipt} clients={[{ id: st.client.id, label: st.client.name }]} today={todayIso()} clientId={st.client.id} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
