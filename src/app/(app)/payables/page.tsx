import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { formatMoney, sumMinor } from "@/lib/money";
import { formatDate, formatInt } from "@/lib/format";
import { SUPPLIER_KIND } from "@/lib/labels";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { ExportButton } from "@/components/export-button";
import { Balance } from "@/components/ledger-bits";

export const metadata: Metadata = { title: "ذمم الموردين" };

/** What we owe each supplier: bought on credit, paid, the balance and cheques the bank has not paid yet. */
export default async function PayablesPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  await requireRole(...FINANCE_ROLES);
  const { all } = await searchParams;
  const supabase = await createClient();
  const today = todayIso();
  const [balRes, accRes] = await Promise.all([
    supabase.from("supplier_balance_v").select("*").order("balance_minor", { ascending: false }),
    supabase.from("accounts").select("id").eq("code", "2101").maybeSingle(),
  ]);
  const rows = (balRes.data ?? []).filter((r) => all === "1" || r.balance_minor !== 0 || r.bought_minor || r.paid_minor || r.cheques_pending_minor);
  const sum = (k: "balance_minor" | "bought_minor" | "paid_minor" | "cheques_pending_minor") => sumMinor(rows.map((r) => r[k]));
  const statement = (id: string) => (accRes.data ? `/ledger/${accRes.data.id}?supplier=${id}&from=${today.slice(0, 4)}-01-01&to=${today}` : null);

  return (
    <>
      <PageHeader
        title="ذمم الموردين"
        subtitle="الرصيد = المشتريات بالآجل (مصاريف وديزل) ناقص الدفعات؛ الشيك المرتجع يعود للمورد"
        action={
          <Link href="/payments" className={buttonClass("primary")}>
            دفعة لمورد
          </Link>
        }
      />
      <div className="flex flex-col gap-5">
        <StatGrid>
          <Stat label="إجمالي المستحق للموردين" value={formatMoney(sum("balance_minor"), "JOD", { fractionDigits: 0 })} />
          <Stat label="مشتريات بالآجل" value={formatMoney(sum("bought_minor"), "JOD", { fractionDigits: 0 })} hint="منذ البداية" />
          <Stat label="المدفوع" value={formatMoney(sum("paid_minor"), "JOD", { fractionDigits: 0 })} hint="منذ البداية" />
          <Stat
            label="شيكات بانتظار الصرف"
            value={formatMoney(sum("cheques_pending_minor"), "JOD", { fractionDigits: 0 })}
            hint="صادرة ولم يصرفها البنك بعد"
            tone={sum("cheques_pending_minor") ? "warning" : "neutral"}
          />
        </StatGrid>

        <Card>
          <CardHeader
            title="الأرصدة حسب المورد"
            subtitle="اضغط على المورد لكشف حسابه"
            action={
              <div className="flex flex-wrap items-center gap-3">
                <ExportButton tableId="payables-table" file="payables" title={`ذمم الموردين في ${formatDate(todayIso())} · المبالغ بالدينار · الرصيد موجب = مدين، سالب = دائن`} />
                <Link href={all === "1" ? "/payables" : "/payables?all=1"} className="text-sm text-primary hover:underline">
                  {all === "1" ? "إخفاء الموردين بدون حركة" : "إظهار كل الموردين"}
                </Link>
              </div>
            }
          />
          {rows.length === 0 ? (
            <EmptyState>لا توجد ذمم للموردين. تظهر هنا المصاريف والديزل المشتراة بالآجل.</EmptyState>
          ) : (
            <Table id="payables-table">
              <thead>
                <tr>
                  <Th>المورد</Th>
                  <Th className="text-end">مشتريات بالآجل</Th>
                  <Th className="text-end">مدفوع</Th>
                  <Th className="text-end">الرصيد</Th>
                  <Th className="text-end">شيكات معلقة</Th>
                  <Th>آخر شراء</Th>
                  <Th>آخر دفعة</Th>
                  <Th>
                    <span className="sr-only">إجراءات</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const href = statement(r.supplier_id as string);
                  return (
                    <Tr key={r.supplier_id}>
                      <Td className="whitespace-nowrap">
                        {href ? (
                          <Link href={href} className="font-medium text-primary hover:underline">
                            {r.name}
                          </Link>
                        ) : (
                          r.name
                        )}
                        <span className="block text-xs text-muted">{SUPPLIER_KIND[r.kind ?? ""] ?? r.kind}</span>
                      </Td>
                      <Td className="num whitespace-nowrap text-end">{formatMoney(r.bought_minor, "JOD", { withCurrency: false })}</Td>
                      <Td className="num whitespace-nowrap text-end">{formatMoney(r.paid_minor, "JOD", { withCurrency: false })}</Td>
                      <Td className="text-end font-semibold">
                        <Balance minor={-(r.balance_minor ?? 0)} />
                      </Td>
                      <Td className="num whitespace-nowrap text-end">
                        {r.cheques_pending_minor ? (
                          <>
                            {formatMoney(r.cheques_pending_minor, "JOD", { withCurrency: false })}
                            <span className="block text-xs text-muted">{formatInt(r.cheques_pending_count ?? 0)} شيك</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td className="num whitespace-nowrap">{formatDate(r.last_purchase)}</Td>
                      <Td className="num whitespace-nowrap">{formatDate(r.last_payment)}</Td>
                      <Td className="whitespace-nowrap">
                        <Link href={`/payments?supplier=${r.supplier_id}`} className="text-xs text-primary hover:underline">
                          دفعة
                        </Link>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
