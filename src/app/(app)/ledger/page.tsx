import type { Metadata } from "next";
import Link from "next/link";
import { BookText } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { statementFilter } from "@/lib/ledger";
import { dayAfter } from "@/lib/ledger-data";
import { formatDate } from "@/lib/format";
import { ACCOUNT_TYPE } from "@/lib/labels";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { ExportButton } from "@/components/export-button";
import { Amount, Balance, StatementFilters } from "@/components/ledger-bits";

export const metadata: Metadata = { title: "كشف الحسابات" };

type SearchParams = Promise<{ from?: string; to?: string; all?: string }>;

// Accounts people open most, shown as shortcuts.
const SHORTCUTS = ["1101", "1102", "1103", "1104", "1105", "2101"];

/** Trial balance (ميزان المراجعة) for a period; each account opens its statement. */
export default async function LedgerPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(...FINANCE_ROLES);
  const sp = await searchParams;
  const f = statementFilter(sp);
  const showAll = sp.all === "1";
  const supabase = await createClient();
  const { data } = await supabase.rpc("trial_balance", { p_from: f.from, p_to: dayAfter(f.to) });
  const all = data ?? [];
  const rows = showAll ? all : all.filter((r) => r.opening_minor || r.debit_minor || r.credit_minor);
  const sum = (k: "opening_minor" | "debit_minor" | "credit_minor" | "closing_minor") => rows.reduce((s, r) => s + Number(r[k]), 0);
  const period = `from=${f.from}&to=${f.to}`;

  return (
    <>
      <PageHeader
        title="كشف الحسابات"
        subtitle={`ميزان المراجعة من ${formatDate(f.from)} إلى ${formatDate(f.to)} · المبالغ بالدينار`}
        action={
          <Link href={`/journal?${period}`} className={buttonClass("secondary")}>
            <BookText className="size-4" aria-hidden />
            دفتر اليومية
          </Link>
        }
      />
      <StatementFilters action="/ledger" filter={f} />

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href={`/ledger/expenses?${period}`} className={buttonClass("primary", "py-1.5")}>
          كشف حساب كل المصاريف
        </Link>
        {SHORTCUTS.map((code) => {
          const a = all.find((r) => r.code === code);
          return a ? (
            <Link key={code} href={`/ledger/${a.account_id}?${period}`} className={buttonClass("secondary", "py-1.5")}>
              {a.name_ar}
            </Link>
          ) : null;
        })}
      </div>

      <Card>
        <CardHeader
          title="ميزان المراجعة"
          subtitle="اضغط على الحساب لكشف حسابه"
          action={
            <div className="flex flex-wrap items-center gap-3">
              <ExportButton tableId="tb-table" file="trial-balance" title={`ميزان المراجعة من ${formatDate(f.from)} إلى ${formatDate(f.to)} · المبالغ بالدينار · الرصيد موجب = مدين، سالب = دائن`} />
              <Link href={`/ledger?${period}${showAll ? "" : "&all=1"}`} className="text-sm text-primary hover:underline">
                {showAll ? "إخفاء الحسابات بدون حركة" : "إظهار كل الحسابات"}
              </Link>
            </div>
          }
        />
        {rows.length === 0 ? (
          <EmptyState>لا توجد قيود حتى هذا التاريخ.</EmptyState>
        ) : (
          <Table id="tb-table">
            <thead>
              <tr>
                <Th>الرمز</Th>
                <Th>الحساب</Th>
                <Th>النوع</Th>
                <Th className="text-end">رصيد أول المدة</Th>
                <Th className="text-end">مدين</Th>
                <Th className="text-end">دائن</Th>
                <Th className="text-end">الرصيد</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.account_id}>
                  <Td className="num">{r.code}</Td>
                  <Td className="whitespace-nowrap">
                    <Link href={`/ledger/${r.account_id}?${period}`} className="text-primary hover:underline">
                      {r.name_ar}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{ACCOUNT_TYPE[r.type] ?? r.type}</Td>
                  <Td className="text-end">
                    <Balance minor={Number(r.opening_minor)} />
                  </Td>
                  <Td className="num whitespace-nowrap text-end">
                    <Amount minor={Number(r.debit_minor)} />
                  </Td>
                  <Td className="num whitespace-nowrap text-end">
                    <Amount minor={Number(r.credit_minor)} />
                  </Td>
                  <Td className="text-end font-medium">
                    <Balance minor={Number(r.closing_minor)} />
                  </Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-surface-2 font-semibold">
                <td className="border-b border-border px-3 py-2" colSpan={3}>
                  المجموع
                </td>
                <td className="border-b border-border px-3 py-2 text-end">
                  <Balance minor={sum("opening_minor")} />
                </td>
                <td className="num whitespace-nowrap border-b border-border px-3 py-2 text-end">
                  <Amount minor={sum("debit_minor")} />
                </td>
                <td className="num whitespace-nowrap border-b border-border px-3 py-2 text-end">
                  <Amount minor={sum("credit_minor")} />
                </td>
                <td className="border-b border-border px-3 py-2 text-end">
                  <Balance minor={sum("closing_minor")} />
                </td>
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </>
  );
}
