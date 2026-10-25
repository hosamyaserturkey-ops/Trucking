import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { truckPage, type TruckPageProps } from "@/lib/truck";
import { addDays, monthsIn, todayIso } from "@/lib/date-range";
import { pnlTotals } from "@/lib/pnl";
import { formatMoney, sumMinor } from "@/lib/money";
import { formatDate, formatInt, formatMonth, formatMonthShort } from "@/lib/format";
import { COST_KINDS, JOURNAL_STATUS, PNL_KIND } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { PnlChart, type PnlPoint } from "@/components/pnl-chart";

export default async function TruckFinancialsPage(props: TruckPageProps) {
  await requireRole(...FINANCE_ROLES);
  const { id, range } = await truckPage(props);
  const supabase = await createClient();
  const today = todayIso();

  const [monthlyRes, assetRes, financingRes, ledgerRes] = await Promise.all([
    supabase.rpc("truck_pnl_monthly", { p_truck_id: id, p_from: range.from, p_to: range.to }),
    supabase.from("truck_assets").select("*").eq("truck_id", id).maybeSingle(),
    supabase
      .from("truck_financing")
      .select("*, financing_installments(installment_no, due_date, amount_base_minor, principal_base_minor, interest_base_minor, paid_on)")
      .eq("truck_id", id),
    supabase
      .from("journal_lines_v")
      .select("*")
      .eq("truck_id", id)
      .gte("entry_date", range.from)
      .lt("entry_date", range.to)
      .order("entry_date", { ascending: false })
      .order("entry_no", { ascending: false })
      .order("line_no"),
  ]);

  const monthly = monthlyRes.data ?? [];
  const asset = assetRes.data;
  const financing = financingRes.data ?? [];
  const ledger = ledgerRes.data ?? [];

  // Months in the range up to the current month (future months have no data yet).
  const currentMonth = `${today.slice(0, 7)}-01`;
  const months = monthsIn(range).filter((m) => m <= currentMonth);
  const perMonth = months.map((m) => ({ month: m, totals: pnlTotals(monthly.filter((r) => r.month === m)) }));
  const overall = pnlTotals(monthly);
  const chartData: PnlPoint[] = perMonth.map(({ month, totals }) => ({
    month,
    label: formatMonthShort(month),
    revenue: totals.revenue / 1000,
    costs: totals.costs / 1000,
    profit: totals.profit / 1000,
  }));

  // Accumulated depreciation from purchase to today.
  let accumulated = 0;
  if (asset?.purchase_date) {
    const { data } = await supabase.rpc("truck_pnl_summary", {
      p_from: asset.purchase_date,
      p_to: addDays(today, 1),
      p_truck_id: id,
    });
    accumulated = sumMinor((data ?? []).filter((r) => r.kind === "depreciation").map((r) => r.amount_base_minor));
  }
  const depreciable = asset ? asset.purchase_cost_base_minor - asset.salvage_value_base_minor : 0;
  const monthlyDep = asset?.useful_life_months ? Math.round(depreciable / asset.useful_life_months) : null;

  const rows: { key: string; label: string; strong?: boolean; tone?: "profit" }[] = [
    { key: "revenue", label: PNL_KIND.revenue, strong: true },
    ...COST_KINDS.map((k) => ({ key: k, label: PNL_KIND[k] })),
    { key: "costs", label: "إجمالي التكاليف", strong: true },
    { key: "profit", label: "صافي الربح", strong: true, tone: "profit" as const },
  ];
  const valueFor = (totals: ReturnType<typeof pnlTotals>, key: string) =>
    key === "revenue" ? totals.revenue : key === "costs" ? totals.costs : key === "profit" ? totals.profit : totals.byKind[key] ?? 0;

  return (
    <>
      <Card>
        <CardHeader title="الأرباح والخسائر شهرياً" subtitle={`${range.label} · بالدينار الأردني`} />
        <CardBody>
          {months.length === 0 ? <EmptyState>لا توجد بيانات لهذه الفترة.</EmptyState> : <PnlChart data={chartData} />}
        </CardBody>
        {months.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <Th>البند</Th>
                {months.map((m) => (
                  <Th key={m} className="text-end">
                    {formatMonth(m)}
                  </Th>
                ))}
                <Th className="text-end">المجموع</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.key} className={row.strong ? "font-semibold" : ""}>
                  <Td className="whitespace-nowrap">{row.label}</Td>
                  {perMonth.map(({ month, totals }) => {
                    const v = valueFor(totals, row.key);
                    return (
                      <Td
                        key={month}
                        className={`num whitespace-nowrap text-end ${row.tone === "profit" ? (v >= 0 ? "text-success" : "text-danger") : ""}`}
                      >
                        {formatMoney(v, "JOD", { fractionDigits: 0, withCurrency: false })}
                      </Td>
                    );
                  })}
                  <Td
                    className={`num whitespace-nowrap text-end ${
                      row.tone === "profit" ? (valueFor(overall, row.key) >= 0 ? "text-success" : "text-danger") : ""
                    }`}
                  >
                    {formatMoney(valueFor(overall, row.key), "JOD", { fractionDigits: 0, withCurrency: false })}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : null}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="الأصل والاستهلاك" subtitle="قسط ثابت حتى القيمة المتبقية" />
          {asset ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-sm">
              <dt className="text-muted">تاريخ الشراء</dt>
              <dd className="num">{formatDate(asset.purchase_date)}</dd>
              <dt className="text-muted">كلفة الشراء</dt>
              <dd className="num">{formatMoney(asset.purchase_cost_base_minor)}</dd>
              <dt className="text-muted">القيمة المتبقية</dt>
              <dd className="num">{formatMoney(asset.salvage_value_base_minor)}</dd>
              <dt className="text-muted">العمر الإنتاجي</dt>
              <dd className="num">{formatInt(asset.useful_life_months)} شهر</dd>
              <dt className="text-muted">الاستهلاك الشهري</dt>
              <dd className="num">{formatMoney(monthlyDep)}</dd>
              <dt className="text-muted">مجمع الاستهلاك</dt>
              <dd className="num">{formatMoney(accumulated)}</dd>
              <dt className="font-semibold">القيمة الدفترية</dt>
              <dd className="num font-semibold">{formatMoney(asset.purchase_cost_base_minor - accumulated)}</dd>
            </dl>
          ) : (
            <EmptyState>لم تُسجل قيمة الشراء لهذه الشاحنة بعد.</EmptyState>
          )}
        </Card>

        <Card>
          <CardHeader title="القروض والتأجير" />
          {financing.length === 0 ? (
            <EmptyState>لا يوجد تمويل على هذه الشاحنة.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {financing.map((f) => {
                const inst = f.financing_installments ?? [];
                const paid = inst.filter((i) => i.paid_on);
                const unpaid = inst.filter((i) => !i.paid_on).sort((a, b) => a.due_date.localeCompare(b.due_date));
                const next = unpaid[0];
                return (
                  <li key={f.id} className="p-4 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{f.lender}</p>
                      <Badge tone="info">{f.kind === "lease" ? "تأجير تمويلي" : "قرض"}</Badge>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                      <dt className="text-muted">رقم العقد</dt>
                      <dd className="num">{f.contract_no ?? "—"}</dd>
                      <dt className="text-muted">أصل المبلغ</dt>
                      <dd className="num">{formatMoney(f.principal_base_minor)}</dd>
                      <dt className="text-muted">الفائدة السنوية</dt>
                      <dd className="num">{f.annual_rate_pct}%</dd>
                      <dt className="text-muted">الأقساط المسددة</dt>
                      <dd className="num">
                        {formatInt(paid.length)} / {formatInt(inst.length)}
                      </dd>
                      <dt className="text-muted">الرصيد المتبقي</dt>
                      <dd className="num font-semibold">{formatMoney(sumMinor(unpaid.map((i) => i.principal_base_minor)))}</dd>
                      {next ? (
                        <>
                          <dt className="text-muted">القسط القادم</dt>
                          <dd className="num">
                            {formatMoney(next.amount_base_minor)} · {formatDate(next.due_date)}
                          </dd>
                        </>
                      ) : null}
                    </dl>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="دفتر أستاذ الشاحنة"
          subtitle="القيود المرحّلة على هذه الشاحنة. القيود المرحّلة لا تُعدّل، والتصحيح بقيد عكسي."
        />
        {ledger.length === 0 ? (
          <EmptyState>لا توجد قيود على هذه الشاحنة في هذه الفترة.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>التاريخ</Th>
                <Th>القيد</Th>
                <Th>البيان</Th>
                <Th>الحساب</Th>
                <Th className="text-end">مدين</Th>
                <Th className="text-end">دائن</Th>
                <Th>الحالة</Th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((l) => {
                const st = JOURNAL_STATUS[l.status ?? "posted"];
                return (
                  <Tr key={l.id}>
                    <Td className="num whitespace-nowrap">{formatDate(l.entry_date)}</Td>
                    <Td className="num">{l.entry_no}</Td>
                    <Td>{l.entry_description}</Td>
                    <Td className="whitespace-nowrap">
                      <span className="num text-muted">{l.account_code}</span> {l.account_name}
                    </Td>
                    <Td className="num whitespace-nowrap text-end">
                      {l.debit_minor ? formatMoney(l.debit_minor, "JOD", { withCurrency: false }) : ""}
                    </Td>
                    <Td className="num whitespace-nowrap text-end">
                      {l.credit_minor ? formatMoney(l.credit_minor, "JOD", { withCurrency: false }) : ""}
                    </Td>
                    <Td>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <p className="px-4 py-3 text-xs text-muted">
          الترحيل التلقائي من الرحلات والمصاريف والفواتير يأتي في مرحلة الحسابات الكاملة. حتى ذلك الحين تُحسب الربحية من العمليات مباشرة.
        </p>
      </Card>
    </>
  );
}
