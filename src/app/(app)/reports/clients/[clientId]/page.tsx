import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { inclusiveEnd, resolveRange } from "@/lib/date-range";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDecimal, formatInt } from "@/lib/format";
import { formatPct, marginPct, parseBasis, PROFIT_BASES, sumRows } from "@/lib/reports";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { DateRangeFilter } from "@/components/date-range-filter";
import { ExportButton } from "@/components/export-button";
import { PrintButton } from "@/components/print-button";
import { Jod, Margin } from "@/components/report-bits";

export const metadata: Metadata = { title: "ربح الزبون" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX = 1000;

type Props = {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string; basis?: string }>;
};

/** One customer's loads with what each earned, its direct costs and its share of the truck's costs. */
export default async function ClientProfitPage({ params, searchParams }: Props) {
  await requireRole(...FINANCE_ROLES);
  const [{ clientId }, sp] = await Promise.all([params, searchParams]);
  if (clientId !== "none" && !UUID.test(clientId)) notFound();
  const range = resolveRange(sp);
  const basis = parseBasis(sp.basis);
  const query = new URLSearchParams(
    Object.entries({ range: sp.range, from: sp.from, to: sp.to, basis }).filter(([, v]) => v) as [string, string][],
  ).toString();
  const supabase = await createClient();
  const [clientRes, tripsRes, trucksRes] = await Promise.all([
    clientId === "none" ? Promise.resolve({ data: null }) : supabase.from("clients").select("id, name, ref_code").eq("id", clientId).maybeSingle(),
    supabase
      .rpc("client_profit_trips", { p_from: range.from, p_to: range.to, p_basis: basis, p_client_id: clientId === "none" ? (null as unknown as string) : clientId })
      .range(0, MAX - 1),
    supabase.from("trucks").select("id, code"),
  ]);
  if (clientId !== "none" && !clientRes.data) notFound();
  const name = clientRes.data?.name ?? "نقلات بلا زبون";
  const code = new Map((trucksRes.data ?? []).map((t) => [t.id, t.code]));
  const rows = tripsRes.data ?? [];
  const total = sumRows(rows, ["revenue_minor", "direct_minor", "allocated_minor", "profit_minor"] as const);
  const losing = rows.filter((r) => r.profit_minor < 0).length;
  const period = `من ${formatDate(range.from)} إلى ${formatDate(inclusiveEnd(range))}`;

  return (
    <>
      <Link href={`/reports/clients?${query}`} className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text print:hidden">
        <ChevronRight className="size-4" aria-hidden />
        ربح الزبائن
      </Link>
      <PageHeader
        title={`ربح الزبون: ${name}`}
        subtitle={`${period} · بالدينار · توزيع تكاليف الشاحنات ${PROFIT_BASES[basis]}`}
        action={
          <div className="flex flex-wrap gap-2">
            {clientId !== "none" ? (
              <Link href={`/receivables/${clientId}`} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-surface-2 print:hidden">
                كشف حساب الزبون
              </Link>
            ) : null}
            <PrintButton />
          </div>
        }
      />
      <div className="mb-5 print:hidden">
        <DateRangeFilter keep={["basis"]} />
      </div>
      <div className="flex flex-col gap-5">
        <StatGrid>
          <Stat label="الإيرادات" value={formatMoney(total.revenue_minor, "JOD", { fractionDigits: 0 })} hint={`${formatInt(rows.length)} نقلة`} />
          <Stat label="التكاليف" value={formatMoney(total.direct_minor + total.allocated_minor, "JOD", { fractionDigits: 0 })} hint="مباشرة وموزعة" />
          <Stat
            label="صافي الربح"
            value={formatMoney(total.profit_minor, "JOD", { fractionDigits: 0 })}
            tone={total.profit_minor >= 0 ? "success" : "danger"}
            hint={`الهامش ${formatPct(marginPct(total.profit_minor, total.revenue_minor))}`}
          />
          <Stat label="نقلات خاسرة" value={formatInt(losing)} tone={losing ? "danger" : "success"} />
        </StatGrid>

        <Card>
          <CardHeader
            title="النقلات"
            subtitle={rows.length >= MAX ? `أول ${formatInt(MAX)} نقلة؛ اختر فترة أقصر` : "بالتاريخ"}
            action={<ExportButton tableId="client-trips-table" file="client-profit-loads" title={`ربح نقلات ${name} ${period} · بالدينار`} />}
          />
          {rows.length === 0 ? (
            <EmptyState>لا توجد نقلات لهذا الزبون في هذه الفترة.</EmptyState>
          ) : (
            <Table id="client-trips-table">
              <thead>
                <tr>
                  <Th>التاريخ</Th>
                  <Th>الإشارة</Th>
                  <Th>الشاحنة</Th>
                  <Th>المسار</Th>
                  <Th>البضاعة</Th>
                  <Th className="text-end">أطنان</Th>
                  <Th className="text-end">كم</Th>
                  <Th className="text-end">الأجرة</Th>
                  <Th className="text-end">تكاليف مباشرة</Th>
                  <Th className="text-end">حصة تكاليف الشاحنة</Th>
                  <Th className="text-end">صافي الربح</Th>
                  <Th className="text-end">الهامش</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.trip_id}>
                    <Td className="num whitespace-nowrap">{formatDate(r.fact_date)}</Td>
                    <Td className="num whitespace-nowrap">
                      <Link href={`/trips/${r.trip_id}`} className="hover:underline">
                        {r.client_ref ?? `#${r.trip_no}`}
                      </Link>
                      {r.entry_source === "sheet" ? (
                        <span className="ms-1">
                          <Badge>كشف</Badge>
                        </span>
                      ) : null}
                      {r.client_doc_no ? (
                        <span className="block text-xs text-muted" dir="ltr">
                          {r.client_doc_no}
                        </span>
                      ) : null}
                    </Td>
                    <Td className="num whitespace-nowrap">{code.get(r.truck_id) ?? ""}</Td>
                    <Td className="whitespace-nowrap">{r.route || "—"}</Td>
                    <Td>{r.cargo_description ?? "—"}</Td>
                    <Td className="num text-end">{r.tons !== null ? formatDecimal(Number(r.tons), 1) : "—"}</Td>
                    <Td className="num text-end">{r.km ? formatInt(r.km) : "—"}</Td>
                    <Td className="text-end">
                      <Jod minor={r.revenue_minor} />
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
                    <Td className="text-end">
                      <Margin profit={r.profit_minor} revenue={r.revenue_minor} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2 font-semibold">
                  <Td>المجموع</Td>
                  <Td className="num">{formatInt(rows.length)} نقلة</Td>
                  <Td />
                  <Td />
                  <Td />
                  <Td />
                  <Td />
                  <Td className="text-end">
                    <Jod minor={total.revenue_minor} />
                  </Td>
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
                </tr>
              </tfoot>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
