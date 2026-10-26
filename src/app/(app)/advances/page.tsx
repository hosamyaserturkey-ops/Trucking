import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { canSeeFinancials, STAFF_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { formatMoney } from "@/lib/money";
import { formatDate, formatInt } from "@/lib/format";
import { issueAdvance } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { AdvanceForm } from "@/components/advance-forms";
import { BalanceText } from "@/components/balance-text";

export const metadata: Metadata = { title: "العهد" };

export default async function AdvancesPage() {
  const profile = await requireRole(...STAFF_ROLES);
  const finance = canSeeFinancials(profile.role);
  const supabase = await createClient();

  const [balancesRes, currenciesRes] = await Promise.all([
    supabase.from("driver_advance_balance_v").select("*").order("full_name"),
    supabase.from("currencies").select("code, rate_to_base"),
  ]);
  const rows = (balancesRes.data ?? []).filter(
    (r) => r.is_active || r.balance_base_minor !== 0 || (r.pending_count ?? 0) > 0,
  );
  const rates = Object.fromEntries((currenciesRes.data ?? []).map((c) => [c.code, String(c.rate_to_base ?? 1)]));

  const withDrivers = rows.reduce((s, r) => s + Math.max(r.balance_base_minor ?? 0, 0), 0);
  const owedToDrivers = rows.reduce((s, r) => s + Math.max(-(r.balance_base_minor ?? 0), 0), 0);
  const pendingCount = rows.reduce((s, r) => s + (r.pending_count ?? 0), 0);

  return (
    <>
      <PageHeader title="العهد" subtitle="رصيد كل سائق منذ آخر تسوية (بالدينار)" />
      <div className="flex flex-col gap-5">
        <StatGrid>
          <Stat label="نقد لدى السائقين" value={formatMoney(withDrivers, "JOD", { fractionDigits: 0 })} />
          <Stat label="مستحق للسائقين" value={formatMoney(owedToDrivers, "JOD", { fractionDigits: 0 })} tone={owedToDrivers ? "success" : "neutral"} />
          <Stat label="مصاريف بانتظار الموافقة" value={formatInt(pendingCount)} tone={pendingCount ? "warning" : "neutral"} />
          <Stat label="عدد السائقين" value={formatInt(rows.length)} />
        </StatGrid>

        <Card>
          <CardHeader title="أرصدة السائقين" />
          {rows.length === 0 ? (
            <EmptyState>لا يوجد سائقون.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>السائق</Th>
                  <Th className="text-end">عهد مفتوحة</Th>
                  <Th className="text-end">مصاريف معتمدة</Th>
                  <Th className="text-end">الرصيد</Th>
                  <Th>بانتظار الموافقة</Th>
                  <Th>آخر تسوية</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.driver_id}>
                    <Td>
                      <Link href={`/advances/${r.driver_id}`} className="font-medium text-primary hover:underline">
                        {r.full_name}
                      </Link>
                    </Td>
                    <Td className="num text-end">{formatMoney(r.open_advances_base_minor, "JOD", { withCurrency: false })}</Td>
                    <Td className="num text-end">{formatMoney(r.open_expenses_base_minor, "JOD", { withCurrency: false })}</Td>
                    <Td className="text-end whitespace-nowrap">
                      <BalanceText minor={r.balance_base_minor ?? 0} />
                    </Td>
                    <Td>{r.pending_count ? <Badge tone="warning">{formatInt(r.pending_count)}</Badge> : "—"}</Td>
                    <Td className="num whitespace-nowrap">{r.last_settled_on ? formatDate(r.last_settled_on) : "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        {finance ? (
          <Card>
            <CardHeader title="صرف عهدة" subtitle="لربط العهدة برحلة افتح صفحة السائق" />
            <CardBody>
              <AdvanceForm
                action={issueAdvance}
                today={todayIso()}
                rates={rates}
                drivers={rows.filter((r) => r.is_active).map((r) => ({ id: r.driver_id!, label: r.full_name ?? "" }))}
              />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
