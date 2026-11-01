import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { inclusiveEnd, resolveRange } from "@/lib/date-range";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDecimal, formatInt } from "@/lib/format";
import { formatPct, marginPct, orderClientRows, parseBasis, PROFIT_BASES, sumRows } from "@/lib/reports";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { DateRangeFilter } from "@/components/date-range-filter";
import { ExportButton } from "@/components/export-button";
import { PrintButton } from "@/components/print-button";
import { Jod, Margin, ReportTabs } from "@/components/report-bits";

export const metadata: Metadata = { title: "ربح الزبائن" };

type SearchParams = Promise<{ range?: string; from?: string; to?: string; basis?: string }>;

const KEYS = ["loads", "revenue_minor", "direct_minor", "allocated_minor", "profit_minor"] as const;

/** Profit per customer: what their loads earned, less the costs they caused and their share of the trucks' costs. */
export default async function ClientProfitReportPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(...FINANCE_ROLES);
  const sp = await searchParams;
  const range = resolveRange(sp);
  const basis = parseBasis(sp.basis);
  const periodQuery = new URLSearchParams(
    Object.entries(sp).filter(([k, v]) => ["range", "from", "to"].includes(k) && v) as [string, string][],
  ).toString();
  const withBasis = (b: string) => [periodQuery, `basis=${b}`].filter(Boolean).join("&");
  const supabase = await createClient();
  const [rowsRes, clientsRes] = await Promise.all([
    supabase.rpc("client_profit_report", { p_from: range.from, p_to: range.to, p_basis: basis }),
    supabase.from("clients").select("id, name, ref_code"),
  ]);
  const clients = new Map((clientsRes.data ?? []).map((c) => [c.id, c]));
  const rows = orderClientRows(
    (rowsRes.data ?? []).map((r) => ({ ...r, tons: Number(r.tons), km: Number(r.km), name: r.client_id ? (clients.get(r.client_id)?.name ?? "") : "" })),
  );
  const total = sumRows(rows, KEYS);
  const costs = total.direct_minor + total.allocated_minor;
  const customers = rows.filter((r) => r.client_id);
  const losing = customers.filter((r) => r.profit_minor < 0).length;
  const period = `من ${formatDate(range.from)} إلى ${formatDate(inclusiveEnd(range))}`;

  return (
    <>
      <PageHeader
        title="تقرير ربح الزبائن"
        subtitle={`${period} · بالدينار · توزيع تكاليف الشاحنات ${PROFIT_BASES[basis]}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ReportTabs active="clients" query={withBasis(basis)} />
            <PrintButton />
          </div>
        }
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <DateRangeFilter keep={["basis"]} />
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="أساس توزيع التكاليف">
          <span className="text-sm text-muted">توزيع التكاليف:</span>
          {Object.entries(PROFIT_BASES).map(([key, label]) => (
            <Link
              key={key}
              href={`/reports/clients?${withBasis(key)}`}
              aria-current={basis === key ? "true" : undefined}
              className={buttonClass(basis === key ? "primary" : "secondary", "py-1.5")}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-5">
        <StatGrid>
          <Stat label="إيرادات الزبائن" value={formatMoney(total.revenue_minor, "JOD", { fractionDigits: 0 })} hint={`${formatInt(total.loads)} نقلة`} />
          <Stat label="التكاليف" value={formatMoney(costs, "JOD", { fractionDigits: 0 })} hint="مباشرة وموزعة وتوقف" />
          <Stat
            label="صافي الربح"
            value={formatMoney(total.profit_minor, "JOD", { fractionDigits: 0 })}
            tone={total.profit_minor >= 0 ? "success" : "danger"}
            hint={`الهامش ${formatPct(marginPct(total.profit_minor, total.revenue_minor))} · يساوي ربح الأسطول`}
          />
          <Stat label="زبائن خاسرون" value={formatInt(losing)} tone={losing ? "danger" : "success"} hint={`من ${formatInt(customers.length)} زبون`} />
        </StatGrid>

        <Card>
          <CardHeader
            title="الربح حسب الزبون"
            subtitle="الأعلى ربحاً أولاً؛ اضغط على الزبون لرؤية نقلاته"
            action={<ExportButton tableId="client-profit-table" file="client-profit" title={`ربح الزبائن ${period} · ${PROFIT_BASES[basis]} · بالدينار`} />}
          />
          {rows.length === 0 ? (
            <EmptyState>لا توجد بيانات لهذه الفترة.</EmptyState>
          ) : (
            <Table id="client-profit-table">
              <thead>
                <tr>
                  <Th>الزبون</Th>
                  <Th className="text-end">نقلات</Th>
                  <Th className="text-end">أطنان</Th>
                  <Th className="text-end">الإيرادات</Th>
                  <Th className="text-end">حصة الإيراد</Th>
                  <Th className="text-end">تكاليف مباشرة</Th>
                  <Th className="text-end">تكاليف الشاحنات الموزعة</Th>
                  <Th className="text-end">صافي الربح</Th>
                  <Th className="text-end">الهامش</Th>
                  <Th className="text-end">ربح النقلة</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const key = r.is_idle ? "idle" : (r.client_id ?? "none");
                  const href = r.is_idle ? null : `/reports/clients/${r.client_id ?? "none"}?${withBasis(basis)}`;
                  const label = r.is_idle ? "تكاليف شاحنات بلا نقلات (توقف)" : r.client_id ? r.name || "—" : "نقلات بلا زبون";
                  return (
                    <Tr key={key} className={r.client_id ? "" : "text-muted"}>
                      <Td className="whitespace-nowrap">
                        {href ? (
                          <Link href={href} className="font-medium hover:underline">
                            {label}
                          </Link>
                        ) : (
                          <span title="تكاليف شاحنة في شهر لم تحمل فيه أي نقلة؛ لا تُحمّل على أي زبون">{label}</span>
                        )}
                        {r.client_id && clients.get(r.client_id)?.ref_code ? (
                          <span className="num ms-2 text-xs text-muted">{clients.get(r.client_id)?.ref_code}</span>
                        ) : null}
                      </Td>
                      <Td className="num text-end">{r.is_idle ? "—" : formatInt(r.loads)}</Td>
                      <Td className="num text-end">{r.is_idle ? "—" : formatDecimal(r.tons, 0)}</Td>
                      <Td className="text-end">
                        <Jod minor={r.revenue_minor} />
                      </Td>
                      <Td className="text-end">
                        <span className="num">{r.is_idle ? "—" : formatPct(marginPct(r.revenue_minor, total.revenue_minor))}</span>
                      </Td>
                      <Td className="text-end">
                        <Jod minor={r.direct_minor} />
                      </Td>
                      <Td className="text-end">
                        <Jod minor={r.allocated_minor} />
                      </Td>
                      <Td className="text-end">
                        <Jod minor={r.profit_minor} strong tone />
                      </Td>
                      <Td className="text-end">{r.is_idle ? "—" : <Margin profit={r.profit_minor} revenue={r.revenue_minor} />}</Td>
                      <Td className="text-end">{r.loads ? <Jod minor={Math.round(r.profit_minor / r.loads)} /> : "—"}</Td>
                    </Tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2 font-semibold">
                  <Td>المجموع</Td>
                  <Td className="num text-end">{formatInt(total.loads)}</Td>
                  <Td />
                  <Td className="text-end">
                    <Jod minor={total.revenue_minor} />
                  </Td>
                  <Td className="num text-end">100%</Td>
                  <Td className="text-end">
                    <Jod minor={total.direct_minor} />
                  </Td>
                  <Td className="text-end">
                    <Jod minor={total.allocated_minor} />
                  </Td>
                  <Td className="text-end">
                    <Jod minor={total.profit_minor} strong tone />
                  </Td>
                  <Td className="text-end">
                    <Margin profit={total.profit_minor} revenue={total.revenue_minor} />
                  </Td>
                  <Td className="text-end">{total.loads ? <Jod minor={Math.round(total.profit_minor / total.loads)} /> : "—"}</Td>
                </tr>
              </tfoot>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="كيف يُحسب ربح الزبون" />
          <CardBody>
            <ul className="flex list-disc flex-col gap-1.5 ps-5 text-sm text-muted">
              <li>
                <strong className="text-text">الإيرادات:</strong> أجرة نقلات الزبون في الفترة (رحلات وكشف تحميل)، بالدينار، كما في ربح الشاحنات.
              </li>
              <li>
                <strong className="text-text">تكاليف مباشرة:</strong> الديزل والمصاريف المسجلة على نقلة من نقلاته بعينها (مثل رسوم المعبر).
              </li>
              <li>
                <strong className="text-text">تكاليف الشاحنات الموزعة:</strong> باقي تكاليف كل شاحنة في كل شهر (ديزل، صيانة، مصاريف، حصة المصاريف العامة، استهلاك، فوائد) تُوزع على نقلات تلك الشاحنة في ذلك الشهر {PROFIT_BASES[basis]}، بدقة الفلس.
              </li>
              <li>
                <strong className="text-text">تكاليف شاحنات بلا نقلات:</strong> تكاليف شاحنة في شهر لم تحمل فيه شيئاً؛ تظهر وحدها ولا تُحمّل على أي زبون.
              </li>
              <li>مجموع الجدول يساوي صافي ربح الأسطول في تقرير الشاحنات للفترة نفسها.</li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
