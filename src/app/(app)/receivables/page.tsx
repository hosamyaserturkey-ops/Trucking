import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, sumMinor } from "@/lib/money";
import { formatDate, formatInt } from "@/lib/format";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Balance } from "@/components/ledger-bits";

export const metadata: Metadata = { title: "ذمم العملاء" };

/** What each customer owes: balance, overdue part, cheques not yet collected and loads not yet invoiced. */
export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  await requireRole(...FINANCE_ROLES);
  const { all } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("client_balance_v").select("*").order("balance_minor", { ascending: false });
  const rows = (data ?? []).filter(
    (r) => all === "1" || r.balance_minor !== 0 || r.unbilled_loads || r.cheques_pending_minor || r.invoiced_minor,
  );
  const sum = (k: "balance_minor" | "overdue_minor" | "cheques_pending_minor" | "unbilled_minor") => sumMinor(rows.map((r) => r[k]));

  return (
    <>
      <PageHeader
        title="ذمم العملاء"
        subtitle="الرصيد = الفواتير الصادرة ناقص المقبوضات؛ الشيك المرتجع يعود على الزبون"
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/receipts" className={buttonClass("secondary")}>
              المقبوضات
            </Link>
            <Link href="/invoices/new" className={buttonClass("primary")}>
              فاتورة جديدة
            </Link>
          </div>
        }
      />
      <div className="flex flex-col gap-5">
        <StatGrid>
          <Stat label="إجمالي الذمم" value={formatMoney(sum("balance_minor"), "JOD", { fractionDigits: 0 })} />
          <Stat label="منها مستحقة متأخرة" value={formatMoney(sum("overdue_minor"), "JOD", { fractionDigits: 0 })} tone={sum("overdue_minor") ? "danger" : "success"} />
          <Stat label="شيكات برسم التحصيل" value={formatMoney(sum("cheques_pending_minor"), "JOD", { fractionDigits: 0 })} hint="مقبوضة ولم تُحصّل بعد" />
          <Stat label="نقلات غير مفوترة" value={formatMoney(sum("unbilled_minor"), "JOD", { fractionDigits: 0 })} tone={sum("unbilled_minor") ? "warning" : "neutral"} />
        </StatGrid>

        <Card>
          <CardHeader
            title="الأرصدة حسب الزبون"
            subtitle="اضغط على الزبون لكشف حسابه"
            action={
              <Link href={all === "1" ? "/receivables" : "/receivables?all=1"} className="text-sm text-primary hover:underline">
                {all === "1" ? "إخفاء الزبائن بدون حركة" : "إظهار كل الزبائن"}
              </Link>
            }
          />
          {rows.length === 0 ? (
            <EmptyState>لا توجد ذمم.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>الزبون</Th>
                  <Th className="text-end">مفوتر</Th>
                  <Th className="text-end">مقبوض</Th>
                  <Th className="text-end">الرصيد</Th>
                  <Th className="text-end">متأخر</Th>
                  <Th className="text-end">شيكات معلقة</Th>
                  <Th className="text-end">غير مفوتر</Th>
                  <Th>آخر فاتورة</Th>
                  <Th>آخر قبض</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.client_id}>
                    <Td className="whitespace-nowrap">
                      <Link href={`/receivables/${r.client_id}`} className="font-medium text-primary hover:underline">
                        {r.name}
                      </Link>
                      {r.ref_code ? <span className="num ms-1 text-xs text-muted">{r.ref_code}</span> : null}
                    </Td>
                    <Td className="num whitespace-nowrap text-end">{formatMoney(r.invoiced_minor, "JOD", { withCurrency: false })}</Td>
                    <Td className="num whitespace-nowrap text-end">{formatMoney(r.received_minor, "JOD", { withCurrency: false })}</Td>
                    <Td className="text-end font-semibold">
                      <Balance minor={r.balance_minor ?? 0} />
                    </Td>
                    <Td className={`num whitespace-nowrap text-end ${r.overdue_minor ? "font-semibold text-danger" : "text-muted"}`}>
                      {formatMoney(r.overdue_minor, "JOD", { withCurrency: false })}
                    </Td>
                    <Td className="num whitespace-nowrap text-end">{formatMoney(r.cheques_pending_minor, "JOD", { withCurrency: false })}</Td>
                    <Td className="num whitespace-nowrap text-end">
                      {r.unbilled_loads ? (
                        <Link href={`/invoices/new?client=${r.client_id}`} className="text-primary hover:underline">
                          {formatMoney(r.unbilled_minor, "JOD", { withCurrency: false })}
                          <span className="block text-xs">{formatInt(r.unbilled_loads)} نقلة</span>
                        </Link>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="num whitespace-nowrap">{formatDate(r.last_invoice)}</Td>
                    <Td className="num whitespace-nowrap">{formatDate(r.last_receipt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
