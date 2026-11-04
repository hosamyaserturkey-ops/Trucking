import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { todayIso } from "@/lib/date-range";
import { refCandidates } from "@/lib/client-loads";
import { findLoadsByRef } from "@/lib/receivables-data";
import { claimStatus } from "@/lib/loading-sheet";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Plate } from "@/components/ui/plate";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { RefSearch } from "@/components/ref-search";
import { CLAIM_TONE, ClaimStatusText } from "@/components/claim-status";

export const metadata: Metadata = { title: "البحث برقم الإشارة" };

/** The statement that holds a load: from the start of the load's year to today, opened at the load. */
function statementHref(clientId: string, loadId: string, date: string) {
  const q = new URLSearchParams({ from: `${date.slice(0, 4)}-01-01`, to: todayIso(), load: loadId });
  return `/receivables/${clientId}?${q}#load`;
}

/**
 * One reference number leads to its load, its invoice (the claim) and its
 * customer's statement. One match opens the statement; several are listed.
 */
export default async function RefLookupPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireRole(...FINANCE_ROLES);
  const q = ((await searchParams).q ?? "").slice(0, 80);
  const loads = q.trim() ? await findLoadsByRef(refCandidates(q), q) : [];
  if (loads.length === 1) redirect(statementHref(loads[0].clientId, loads[0].id, loads[0].date));

  return (
    <>
      <Link href="/receivables" className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        ذمم العملاء
      </Link>
      <PageHeader title="البحث برقم الإشارة" subtitle="رقم الإشارة يوصل النقلة بكشف التحميل وبفاتورتها وبكشف حساب الزبون" />
      <RefSearch defaultValue={q} className="mb-4" />
      <Card>
        <CardHeader title={q.trim() ? `نتائج «${q.trim()}»` : "اكتب رقم الإشارة"} />
        {!q.trim() ? (
          <EmptyState>اكتب رقم الإشارة، مثل ARB-0041، أو رقم مستند الزبون.</EmptyState>
        ) : loads.length === 0 ? (
          <EmptyState>لا توجد نقلة بهذا الرقم.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>رقم الإشارة</Th>
                <Th>التاريخ</Th>
                <Th>الزبون</Th>
                <Th>المسار</Th>
                <Th>مستند الزبون</Th>
                <Th className="text-end">الأجرة</Th>
                <Th>المطالبة</Th>
              </tr>
            </thead>
            <tbody>
              {loads.map((l) => {
                const claim = claimStatus({ status: l.status, client_id: l.clientId, is_empty_return: l.isEmptyReturn, invoice_id: l.invoiceId });
                return (
                  <Tr key={l.id} tone={claim ? CLAIM_TONE[claim] : undefined}>
                    <Td className="num whitespace-nowrap">
                      <Link href={statementHref(l.clientId, l.id, l.date)} className="font-semibold text-primary hover:underline" dir="ltr">
                        <Plate>{l.ref}</Plate>
                      </Link>
                    </Td>
                    <Td className="num whitespace-nowrap">{formatDate(l.date)}</Td>
                    <Td className="whitespace-nowrap">{l.client ?? "—"}</Td>
                    <Td className="whitespace-nowrap">{l.route}</Td>
                    <Td className="num">
                      <span dir="ltr">{l.docNo ?? "—"}</span>
                    </Td>
                    <Td className="num whitespace-nowrap text-end">{formatMoney(l.freightMinor, l.currency)}</Td>
                    <Td className="whitespace-nowrap">
                      <ClaimStatusText claim={claim} />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
