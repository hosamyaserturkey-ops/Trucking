import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronRight, Printer } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { canSeeFinancials, STAFF_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { openLedger } from "@/lib/advances";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDecimal, formatInt } from "@/lib/format";
import { issueAdvance, settleDriver } from "../actions";
import { Badge } from "@/components/ui/badge";
import { LinkButton, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { AdvanceForm, SettleForm } from "@/components/advance-forms";
import { BalanceText } from "@/components/balance-text";

export const metadata: Metadata = { title: "عهدة السائق" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHOD: Record<string, string> = { cash: "نقداً", bank: "تحويل بنكي" };

export default async function DriverAdvancePage({
  params,
  searchParams,
}: {
  params: Promise<{ driverId: string }>;
  searchParams: Promise<{ settled?: string }>;
}) {
  const profile = await requireRole(...STAFF_ROLES);
  const finance = canSeeFinancials(profile.role);
  const { driverId } = await params;
  const { settled } = await searchParams;
  if (!UUID.test(driverId)) notFound();
  const supabase = await createClient();

  const [balanceRes, advancesRes, expensesRes, settlementsRes, tripsRes, currenciesRes, fuelRes] = await Promise.all([
    supabase.from("driver_advance_balance_v").select("*").eq("driver_id", driverId).maybeSingle(),
    supabase
      .from("driver_advances")
      .select("id, issued_on, currency, amount_minor, amount_base_minor, method, notes, trip:trips(id, trip_no)")
      .eq("driver_id", driverId)
      .is("settlement_id", null),
    supabase
      .from("expenses")
      .select("id, expense_date, currency, amount_minor, amount_base_minor, description, category:expense_categories(name_ar), trip:trips(id, trip_no)")
      .eq("driver_id", driverId)
      .is("settlement_id", null)
      .eq("status", "approved")
      .eq("payment_method", "driver_advance"),
    supabase
      .from("driver_settlements")
      .select("id, settlement_no, settled_on, advances_base_minor, expenses_base_minor, difference_base_minor, advances_count, expenses_count, notes")
      .eq("driver_id", driverId)
      .order("settled_on", { ascending: false })
      .order("settlement_no", { ascending: false }),
    supabase
      .from("trip_profit_v")
      .select("trip_id, trip_no, from_name, to_name, start_date")
      .eq("driver_id", driverId)
      .neq("status", "cancelled")
      .order("start_date", { ascending: false })
      .limit(15),
    supabase.from("currencies").select("code, rate_to_base"),
    // Diesel the driver paid from the advance, approved and not settled yet.
    supabase
      .from("fuel_fillups")
      .select("id, filled_at, liters, odometer, currency, amount_minor, amount_base_minor, trip:trips(id, trip_no)")
      .eq("driver_id", driverId)
      .is("settlement_id", null)
      .eq("status", "approved")
      .eq("payment_method", "driver_advance"),
  ]);
  const balance = balanceRes.data;
  if (!balance) notFound();

  type TripRef = { id: string; trip_no: number } | null;
  const ledger = openLedger([
    ...(advancesRes.data ?? []).map((a) => ({
      id: a.id,
      kind: "advance" as const,
      date: a.issued_on,
      base_minor: a.amount_base_minor,
      label: `عهدة ${METHOD[a.method] ?? a.method}${a.notes ? ` · ${a.notes}` : ""}`,
      currency: a.currency,
      amount_minor: a.amount_minor,
      trip: a.trip as TripRef,
    })),
    ...(expensesRes.data ?? []).map((e) => {
      const category = (e.category as { name_ar: string } | null)?.name_ar;
      return {
        id: e.id,
        kind: "expense" as const,
        date: e.expense_date,
        base_minor: e.amount_base_minor,
        label: category && e.description && e.description !== category ? `${category} · ${e.description}` : (category ?? e.description),
        currency: e.currency,
        amount_minor: e.amount_minor,
        trip: e.trip as TripRef,
      };
    }),
    ...(fuelRes.data ?? []).map((f) => ({
      id: f.id,
      kind: "expense" as const,
      // Same date rule as settle_driver_advance: the fill-up's day in Amman.
      date: todayIso(new Date(f.filled_at)),
      base_minor: f.amount_base_minor,
      label: `ديزل · ${formatDecimal(Number(f.liters))} لتر · العداد ${formatInt(f.odometer)}`,
      currency: f.currency,
      amount_minor: f.amount_minor,
      trip: f.trip as TripRef,
    })),
  ]);
  const settlements = settlementsRes.data ?? [];
  const justSettled = settled ? settlements.find((s) => s.id === settled) : undefined;
  const rates = Object.fromEntries((currenciesRes.data ?? []).map((c) => [c.code, String(c.rate_to_base ?? 1)]));
  const today = todayIso();
  const pendingCount = balance.pending_count ?? 0;

  return (
    <>
      <PageHeader
        title={`عهدة ${balance.full_name}`}
        subtitle={balance.last_settled_on ? `آخر تسوية ${formatDate(balance.last_settled_on)}` : "لا توجد تسوية سابقة"}
        action={
          <LinkButton href="/advances" variant="ghost">
            <ChevronRight className="size-4" aria-hidden />
            كل السائقين
          </LinkButton>
        }
      />
      <div className="flex flex-col gap-5">
        {justSettled ? (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-success-soft px-4 py-3 text-sm text-success">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="size-4" aria-hidden />
              تمت التسوية رقم <span className="num">{justSettled.settlement_no}</span>
            </span>
            <Link href={`/print/settlements/${justSettled.id}`} target="_blank" className={buttonClass("secondary")}>
              <Printer className="size-4" aria-hidden />
              طباعة سند التسوية
            </Link>
          </div>
        ) : null}

        <StatGrid>
          <Stat label="الرصيد" value={<BalanceText minor={balance.balance_base_minor ?? 0} />} />
          <Stat label="عهد مفتوحة" value={formatMoney(balance.open_advances_base_minor, "JOD")} />
          <Stat
            label="مصاريف وديزل دفعها"
            value={formatMoney(balance.open_expenses_base_minor, "JOD")}
            hint={`منها ديزل ${formatMoney(balance.open_fuel_base_minor ?? 0, "JOD")}`}
          />
          <Stat
            label="بانتظار الموافقة"
            value={formatMoney(balance.pending_base_minor, "JOD")}
            hint={`${formatInt(pendingCount)} بند`}
            tone={pendingCount ? "warning" : "neutral"}
          />
        </StatGrid>

        {pendingCount > 0 ? (
          <p className="flex flex-wrap items-center gap-2 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
            <AlertTriangle className="size-4" aria-hidden />
            لدى السائق {formatInt(pendingCount)} مصروف أو تعبئة بانتظار الموافقة ولن تدخل في التسوية قبل مراجعتها.
            {finance ? (
              <Link href="/approvals" className="font-semibold underline">
                مراجعتها الآن
              </Link>
            ) : null}
          </p>
        ) : null}

        <Card>
          <CardHeader title="الحركات المفتوحة" subtitle="منذ آخر تسوية، بالترتيب الزمني" />
          {ledger.length === 0 ? (
            <EmptyState>لا توجد حركات مفتوحة.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>التاريخ</Th>
                  <Th>البيان</Th>
                  <Th>الرحلة</Th>
                  <Th className="text-end">المبلغ</Th>
                  <Th className="text-end">له / عليه (د.أ)</Th>
                  <Th className="text-end">الرصيد</Th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => (
                  <Tr key={r.id}>
                    <Td className="num whitespace-nowrap">{formatDate(r.date)}</Td>
                    <Td className="whitespace-nowrap">
                      <Badge tone={r.kind === "advance" ? "info" : "neutral"}>{r.kind === "advance" ? "عهدة" : "مصروف"}</Badge>{" "}
                      {r.label}
                    </Td>
                    <Td className="num">
                      {r.trip ? (
                        <Link href={`/trips/${r.trip.id}`} className="hover:underline">
                          {r.trip.trip_no}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="num text-end whitespace-nowrap">{formatMoney(r.amount_minor, r.currency)}</Td>
                    <Td className={`num text-end ${r.signed_minor < 0 ? "text-danger" : ""}`}>
                      {formatMoney(r.signed_minor, "JOD", { withCurrency: false })}
                    </Td>
                    <Td className="num text-end font-medium">{formatMoney(r.balance_minor, "JOD", { withCurrency: false })}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        {finance ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="تسوية العهدة" subtitle="تُغلق الحركات حتى التاريخ المختار ولا يمكن تعديلها بعد ذلك" />
              <CardBody>
                <SettleForm
                  action={settleDriver.bind(null, driverId)}
                  today={today}
                  items={ledger.map(({ id, kind, date, base_minor }) => ({ id, kind, date, base_minor }))}
                  pendingCount={pendingCount}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="صرف عهدة" />
              <CardBody>
                <AdvanceForm
                  action={issueAdvance}
                  today={today}
                  rates={rates}
                  driverId={driverId}
                  trips={(tripsRes.data ?? []).map((t) => ({
                    id: t.trip_id!,
                    label: `#${t.trip_no} · ${t.from_name} ← ${t.to_name} · ${formatDate(t.start_date)}`,
                  }))}
                />
              </CardBody>
            </Card>
          </div>
        ) : null}

        <Card>
          <CardHeader title="التسويات السابقة" />
          {settlements.length === 0 ? (
            <EmptyState>لا توجد تسويات.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>رقم</Th>
                  <Th>التاريخ</Th>
                  <Th className="text-end">العهد</Th>
                  <Th className="text-end">المصاريف</Th>
                  <Th className="text-end">الفرق</Th>
                  <Th>
                    <span className="sr-only">طباعة</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <Tr key={s.id}>
                    <Td className="num">{s.settlement_no}</Td>
                    <Td className="num whitespace-nowrap">{formatDate(s.settled_on)}</Td>
                    <Td className="num text-end">{formatMoney(s.advances_base_minor, "JOD", { withCurrency: false })}</Td>
                    <Td className="num text-end">{formatMoney(s.expenses_base_minor, "JOD", { withCurrency: false })}</Td>
                    <Td className="text-end whitespace-nowrap">
                      <BalanceText minor={s.difference_base_minor} />
                    </Td>
                    <Td>
                      {finance ? (
                        <Link href={`/print/settlements/${s.id}`} target="_blank" className="text-xs text-primary hover:underline">
                          سند التسوية
                        </Link>
                      ) : null}
                    </Td>
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
