import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { inclusiveEnd, monthsIn, resolveRange } from "@/lib/date-range";
import { formatMoney } from "@/lib/money";
import { formatDate, formatInt, formatMonthShort } from "@/lib/format";
import { formatPct, marginPct, perKm, sumRows } from "@/lib/reports";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { DateRangeFilter } from "@/components/date-range-filter";
import { ExportButton } from "@/components/export-button";
import { PrintButton } from "@/components/print-button";
import { PnlChart, type PnlPoint } from "@/components/pnl-chart";
import { Jod, Margin, ReportTabs } from "@/components/report-bits";

export const metadata: Metadata = { title: "ربح الشاحنات" };

type SearchParams = Promise<{ range?: string; from?: string; to?: string }>;

const KEYS = [
  "revenue_minor",
  "fuel_minor",
  "maintenance_minor",
  "expense_minor",
  "overhead_minor",
  "depreciation_minor",
  "interest_minor",
  "costs_minor",
  "profit_minor",
  "trips",
  "km",
] as const;

/** Profit per truck for a period: revenue, each kind of cost, km and per-km figures, and month by month. */
export default async function TruckProfitReportPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(...FINANCE_ROLES);
  const sp = await searchParams;
  const range = resolveRange(sp);
  const query = new URLSearchParams(Object.entries(sp).filter(([k, v]) => ["range", "from", "to"].includes(k) && v) as [string, string][]).toString();
  const supabase = await createClient();
  const [rowsRes, monthlyRes, trucksRes] = await Promise.all([
    supabase.rpc("truck_profit_report", { p_from: range.from, p_to: range.to }),
    supabase.rpc("truck_profit_monthly", { p_from: range.from, p_to: range.to }),
    supabase.from("trucks").select("id, code, plate_number, make, model, is_active"),
  ]);
  const trucks = new Map((trucksRes.data ?? []).map((t) => [t.id, t]));
  const rows = (rowsRes.data ?? [])
    .map((r) => ({ ...r, km: Number(r.km), code: trucks.get(r.truck_id)?.code ?? "" }))
    .sort((a, b) => b.profit_minor - a.profit_minor || a.code.localeCompare(b.code));
  const total = sumRows(rows, KEYS);
  const months = monthsIn(range);
  const monthly = monthlyRes.data ?? [];
  const cell = new Map(monthly.map((m) => [`${m.truck_id}|${m.month}`, m]));
  const fleet = months.map((m) => {
    const ms = monthly.filter((x) => x.month === m);
    const revenue = ms.reduce((s, x) => s + x.revenue_minor, 0);
    const costs = ms.reduce((s, x) => s + x.costs_minor, 0);
    return { month: m, revenue, costs, profit: revenue - costs };
  });
  const chart: PnlPoint[] = fleet.map((x) => ({
    month: x.month,
    label: formatMonthShort(x.month),
    revenue: x.revenue / 1000,
    costs: x.costs / 1000,
    profit: x.profit / 1000,
  }));
  const losing = rows.filter((r) => r.profit_minor < 0).length;
  const period = `من ${formatDate(range.from)} إلى ${formatDate(inclusiveEnd(range))}`;

  return (
    <>
      <PageHeader
        title="تقرير ربح الشاحنات"
        subtitle={`${period} · بالدينار · من نفس أرقام ملف الشاحنة`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ReportTabs active="trucks" query={query} />
            <PrintButton />
          </div>
        }
      />
      <div className="mb-5 print:hidden">
        <DateRangeFilter />
      </div>
      <div className="flex flex-col gap-5">
        <StatGrid>
          <Stat label="الإيرادات" value={formatMoney(total.revenue_minor, "JOD", { fractionDigits: 0 })} />
          <Stat label="التكاليف" value={formatMoney(total.costs_minor, "JOD", { fractionDigits: 0 })} />
          <Stat
            label="صافي الربح"
            value={formatMoney(total.profit_minor, "JOD", { fractionDigits: 0 })}
            tone={total.profit_minor >= 0 ? "success" : "danger"}
            hint={`الهامش ${formatPct(marginPct(total.profit_minor, total.revenue_minor))}`}
          />
          <Stat
            label="شاحنات خاسرة"
            value={formatInt(losing)}
            tone={losing ? "danger" : "success"}
            hint={`من ${formatInt(rows.length)} شاحنة · ${formatInt(total.km)} كم`}
          />
        </StatGrid>

        <Card>
          <CardHeader
            title="الربح حسب الشاحنة"
            subtitle="الأعلى ربحاً أولاً. الصيانة: أوامر مغلقة فقط. المصاريف العامة موزعة على الشاحنات حسب إعداد الشركة."
            action={<ExportButton tableId="truck-profit-table" file="truck-profit" title={`ربح الشاحنات ${period} · بالدينار`} />}
          />
          {rows.length === 0 ? (
            <EmptyState>لا توجد بيانات لهذه الفترة.</EmptyState>
          ) : (
            <Table id="truck-profit-table">
              <thead>
                <tr>
                  <Th>الشاحنة</Th>
                  <Th className="text-end">رحلات</Th>
                  <Th className="text-end">كم</Th>
                  <Th className="text-end">الإيرادات</Th>
                  <Th className="text-end">الديزل</Th>
                  <Th className="text-end">الصيانة</Th>
                  <Th className="text-end">مصاريف مباشرة</Th>
                  <Th className="text-end">مصاريف عامة</Th>
                  <Th className="text-end">الاستهلاك</Th>
                  <Th className="text-end">الفوائد</Th>
                  <Th className="text-end">مجموع التكاليف</Th>
                  <Th className="text-end">صافي الربح</Th>
                  <Th className="text-end">الهامش</Th>
                  <Th className="text-end">تكلفة / كم</Th>
                  <Th className="text-end">ربح / كم</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.truck_id}>
                    <Td className="whitespace-nowrap">
                      <Link href={`/trucks/${r.truck_id}?${query}`} className="num font-semibold hover:underline">
                        {r.code}
                      </Link>
                      <span className="num ms-2 text-xs text-muted">{trucks.get(r.truck_id)?.plate_number}</span>
                    </Td>
                    <Td className="num text-end">{formatInt(r.trips)}</Td>
                    <Td className="num text-end">{formatInt(r.km)}</Td>
                    <Td className="text-end">
                      <Jod minor={r.revenue_minor} />
                    </Td>
                    <Td className="text-end">
                      <Jod minor={r.fuel_minor} />
                    </Td>
                    <Td className="text-end">
                      <Jod minor={r.maintenance_minor} />
                    </Td>
                    <Td className="text-end">
                      <Jod minor={r.expense_minor} />
                    </Td>
                    <Td className="text-end">
                      <Jod minor={r.overhead_minor} />
                    </Td>
                    <Td className="text-end">
                      <Jod minor={r.depreciation_minor} />
                    </Td>
                    <Td className="text-end">
                      <Jod minor={r.interest_minor} />
                    </Td>
                    <Td className="text-end">
                      <Jod minor={r.costs_minor} />
                    </Td>
                    <Td className="text-end">
                      <Jod minor={r.profit_minor} strong tone />
                    </Td>
                    <Td className="text-end">
                      <Margin profit={r.profit_minor} revenue={r.revenue_minor} />
                    </Td>
                    <Td className="text-end">
                      <PerKm minor={r.costs_minor} km={r.km} />
                    </Td>
                    <Td className="text-end">
                      <PerKm minor={r.profit_minor} km={r.km} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2 font-semibold">
                  <Td>المجموع</Td>
                  <Td className="num text-end">{formatInt(total.trips)}</Td>
                  <Td className="num text-end">{formatInt(total.km)}</Td>
                  {(["revenue_minor", "fuel_minor", "maintenance_minor", "expense_minor", "overhead_minor", "depreciation_minor", "interest_minor", "costs_minor"] as const).map((k) => (
                    <Td key={k} className="text-end">
                      <Jod minor={total[k]} />
                    </Td>
                  ))}
                  <Td className="text-end">
                    <Jod minor={total.profit_minor} strong tone />
                  </Td>
                  <Td className="text-end">
                    <Margin profit={total.profit_minor} revenue={total.revenue_minor} />
                  </Td>
                  <Td className="text-end">
                    <PerKm minor={total.costs_minor} km={total.km} />
                  </Td>
                  <Td className="text-end">
                    <PerKm minor={total.profit_minor} km={total.km} />
                  </Td>
                </tr>
              </tfoot>
            </Table>
          )}
          <p className="border-t border-border px-4 py-2 text-xs text-muted">
            كم: من الرحلات المسجلة بقراءات العداد؛ نقلات كشف التحميل بلا كيلومترات، فتكلفة الكيلومتر تقريبية للشاحنات التي تعمل بالكشف.
          </p>
        </Card>

        {months.length > 1 && rows.length > 0 ? (
          <>
            <Card>
              <CardHeader title="الأسطول شهرياً" subtitle="الإيرادات والتكاليف وصافي الربح" />
              <div className="p-4">
                <PnlChart data={chart} />
              </div>
            </Card>
            <Card>
              <CardHeader
                title="صافي الربح شهرياً لكل شاحنة"
                action={<ExportButton tableId="truck-month-table" file="truck-profit-monthly" title={`صافي ربح الشاحنات شهرياً ${period} · بالدينار`} />}
              />
              <Table id="truck-month-table">
                <thead>
                  <tr>
                    <Th>الشاحنة</Th>
                    {months.map((m) => (
                      <Th key={m} className="text-end">
                        {formatMonthShort(m)} <span className="num">{m.slice(2, 4)}</span>
                      </Th>
                    ))}
                    <Th className="text-end">المجموع</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Tr key={r.truck_id}>
                      <Td className="num whitespace-nowrap font-semibold">{r.code}</Td>
                      {months.map((m) => {
                        const c = cell.get(`${r.truck_id}|${m}`);
                        return (
                          <Td key={m} className="text-end">
                            {c ? <Jod minor={c.revenue_minor - c.costs_minor} tone /> : <span className="text-muted">—</span>}
                          </Td>
                        );
                      })}
                      <Td className="text-end">
                        <Jod minor={r.profit_minor} strong tone />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-surface-2 font-semibold">
                    <Td>الأسطول</Td>
                    {fleet.map((c) => (
                      <Td key={c.month} className="text-end">
                        <Jod minor={c.profit} tone />
                      </Td>
                    ))}
                    <Td className="text-end">
                      <Jod minor={total.profit_minor} strong tone />
                    </Td>
                  </tr>
                </tfoot>
              </Table>
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}

function PerKm({ minor, km }: { minor: number; km: number }) {
  const v = perKm(minor, km);
  if (v === null) return <span className="text-muted">—</span>;
  return (
    <span className="num whitespace-nowrap" data-x={(v / 1000).toFixed(3)}>
      {formatMoney(v, "JOD", { withCurrency: false })}
    </span>
  );
}
