import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Printer } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { filterQuery, sourceHref, statementFilter } from "@/lib/ledger";
import { loadStatement, loadStatementParties, type StatementLine } from "@/lib/ledger-data";
import { formatDate, formatInt } from "@/lib/format";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Amount, Balance, StatementFilters } from "@/components/ledger-bits";

export const metadata: Metadata = { title: "كشف حساب" };

type Params = Promise<{ account: string }>;
type SearchParams = Promise<{ from?: string; to?: string; truck?: string; supplier?: string; driver?: string; client?: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One account (or all expense accounts) over a period: opening, every line with its documents, running balance. */
/** The paper documents behind a line, one per row, labelled. */
function DocNumbers({ line }: { line: StatementLine }) {
  const docs: [string, string | number | null][] = [
    ["فاتورة", line.invoice_no],
    ["سند قبض", line.receipt_no],
    ["شيك", line.cheque_no],
    ["بيان جمركي", line.customs_declaration_no],
    ["سند صرف", line.voucher_no],
    ["إشعار", line.notice_no],
  ];
  return (
    <>
      {docs
        .filter(([, v]) => v)
        .map(([label, v]) => (
          <span key={label} className="block">
            <span className="text-muted">{label}: </span>
            <span className="num" dir="ltr">
              {v}
            </span>
          </span>
        ))}
    </>
  );
}

export default async function StatementPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await requireRole(...FINANCE_ROLES);
  const { account } = await params;
  if (account !== "expenses" && !UUID.test(account)) notFound();
  const f = statementFilter(await searchParams);
  const [st, parties] = await Promise.all([loadStatement(account, f), loadStatementParties()]);
  if (!st) notFound();
  const q = filterQuery(f);

  return (
    <>
      <Link href={`/ledger?from=${f.from}&to=${f.to}`} className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        كشف الحسابات
      </Link>
      <PageHeader
        title={`كشف حساب: ${st.title}`}
        subtitle={`من ${formatDate(f.from)} إلى ${formatDate(f.to)}`}
        action={
          <Link href={`/print/ledger/${account}?${q}`} target="_blank" className={buttonClass("secondary")}>
            <Printer className="size-4" aria-hidden />
            طباعة الكشف
          </Link>
        }
      />
      <StatementFilters action={`/ledger/${account}`} filter={f} {...parties} />

      <div className="flex flex-col gap-5">
        <StatGrid>
          <Stat label="رصيد أول المدة" value={<Balance minor={st.opening} />} />
          <Stat label="مجموع المدين" value={<Amount minor={st.debit} />} />
          <Stat label="مجموع الدائن" value={<Amount minor={st.credit} />} />
          <Stat label="الرصيد" value={<Balance minor={st.closing} />} />
        </StatGrid>

        <Card>
          <CardHeader
            title="الحركات"
            subtitle={`${formatInt(st.lines.length)} حركة · المبالغ بالدينار · القيد المرحّل لا يُعدّل، والتصحيح بقيد عكسي`}
          />
          {st.truncated ? (
            <p role="status" className="mx-4 mt-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
              تظهر أول {formatInt(st.lines.length)} حركة فقط؛ اختر فترة أقصر لرؤية الباقي والرصيد الصحيح في آخرها.
            </p>
          ) : null}
          {st.lines.length === 0 && st.opening === 0 ? (
            <EmptyState>لا توجد حركات في هذه الفترة.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>التاريخ</Th>
                  <Th>رقم القيد</Th>
                  <Th>البيان</Th>
                  <Th>الشاحنة / الطرف</Th>
                  <Th>المستندات</Th>
                  <Th className="text-end">مدين</Th>
                  <Th className="text-end">دائن</Th>
                  <Th className="text-end">الرصيد</Th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-surface-2/60">
                  <Td className="num whitespace-nowrap">{formatDate(f.from)}</Td>
                  <Td />
                  <Td className="font-medium">رصيد أول المدة</Td>
                  <td className="border-b border-border" colSpan={4} />
                  <Td className="text-end font-medium">
                    <Balance minor={st.opening} />
                  </Td>
                </tr>
                {st.lines.map((l) => {
                  const href = sourceHref(l.source_type, l.source_id);
                  const muted = l.status === "reversed" || l.is_reversal;
                  return (
                    <Tr key={l.id} className={muted ? "text-muted" : ""}>
                      <Td className="num whitespace-nowrap">{formatDate(l.entry_date)}</Td>
                      <Td className="num">
                        <Link href={`/journal?entry=${l.entry_no}`} className="hover:underline">
                          {l.entry_no}
                        </Link>
                      </Td>
                      <Td className="min-w-44">
                        {href ? (
                          <Link href={href} className="hover:underline">
                            {l.description}
                          </Link>
                        ) : (
                          l.description
                        )}
                        {l.status === "reversed" ? <span className="ms-1 text-xs">(معكوس)</span> : null}
                        {st.multiAccount ? <span className="block text-xs text-muted">{l.account}</span> : null}
                        {l.reference_no ? <span className="block text-xs text-muted" dir="ltr">{l.reference_no}</span> : null}
                        {l.notes ? <span className="block text-xs text-muted">ملاحظات: {l.notes}</span> : null}
                      </Td>
                      <Td className="whitespace-nowrap">{l.party ?? "—"}</Td>
                      <Td className="whitespace-nowrap text-xs">
                        <DocNumbers line={l} />
                      </Td>
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
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2 font-semibold">
                  <td className="border-b border-border px-3 py-2" colSpan={5}>
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
      </div>
    </>
  );
}
