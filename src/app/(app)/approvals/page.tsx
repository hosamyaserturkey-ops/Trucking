import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, FileX2 } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, formatDecimal, formatInt } from "@/lib/format";
import { pricePerLiter } from "@/lib/fuel";
import { loadFuelChecks } from "@/lib/fuel-context";
import { EXPENSE_STATUS, PAYMENT_METHOD } from "@/lib/labels";
import { approveExpense, approveFillup, rejectExpense, rejectFillup } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { ExpenseReview, FuelReview } from "@/components/expense-review";

export const metadata: Metadata = { title: "الموافقات" };

const EXPENSE_FIELDS =
  "id, expense_date, description, currency, amount_minor, amount_base_minor, fx_rate, payment_method, status, rejection_reason, receipt_path, created_at, reviewed_at, category_id, category:expense_categories(name_ar), driver:drivers(id, full_name), truck:trucks(id, code), trip:trips(id, trip_no)";
const FUEL_FIELDS =
  "id, truck_id, filled_at, odometer, liters, is_full_tank, currency, amount_minor, fx_rate, payment_method, status, rejection_reason, receipt_path, notes, created_at, reviewed_at, driver:drivers(id, full_name), truck:trucks(id, code), trip:trips(id, trip_no), station:suppliers(name)";

type Joined = {
  category?: { name_ar: string } | null;
  driver: { id: string; full_name: string } | null;
  truck: { id: string; code: string } | null;
  trip: { id: string; trip_no: number } | null;
  station?: { name: string } | null;
};

/** Receipt thumbnail. Opened through /files/…: RLS decides, and each view gets a fresh short-lived link. */
function Receipt({ href, alt }: { href: string | null; alt: string }) {
  if (!href) {
    return (
      <div className="flex h-32 w-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-xs text-muted">
        <FileX2 className="size-5" aria-hidden />
        بلا إيصال
      </div>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" title="فتح الإيصال بالحجم الكامل">
      {/* eslint-disable-next-line @next/next/no-img-element -- private file behind /files/ */}
      <img src={href} alt={alt} className="h-32 w-28 rounded-lg border border-border bg-surface-2 object-cover" />
    </a>
  );
}

function Who({ j }: { j: Joined }) {
  return (
    <p className="text-muted">
      {j.driver?.full_name ?? "—"}
      {j.truck ? (
        <>
          {" "}
          ·{" "}
          <Link href={`/trucks/${j.truck.id}`} className="num hover:underline">
            {j.truck.code}
          </Link>
        </>
      ) : null}
      {j.trip ? (
        <>
          {" "}
          · رحلة{" "}
          <Link href={`/trips/${j.trip.id}`} className="num hover:underline">
            {j.trip.trip_no}
          </Link>
        </>
      ) : null}
    </p>
  );
}

// Driver expenses and diesel wait here until the accountant or manager approves or rejects them.
export default async function ApprovalsPage() {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();

  const [pendingRes, fuelRes, recentRes, recentFuelRes, catsRes] = await Promise.all([
    supabase.from("expenses").select(EXPENSE_FIELDS).eq("status", "submitted").order("created_at"),
    supabase.from("fuel_fillups").select(FUEL_FIELDS).eq("status", "submitted").order("created_at"),
    supabase.from("expenses").select(EXPENSE_FIELDS).not("reviewed_at", "is", null).order("reviewed_at", { ascending: false }).limit(15),
    supabase.from("fuel_fillups").select(FUEL_FIELDS).not("reviewed_at", "is", null).order("reviewed_at", { ascending: false }).limit(15),
    supabase.from("expense_categories").select("id, name_ar").eq("is_active", true).order("sort_order"),
  ]);
  const pending = pendingRes.data ?? [];
  const fuel = fuelRes.data ?? [];
  const categories = (catsRes.data ?? []).map((c) => ({ id: c.id, label: c.name_ar }));
  const checks = await loadFuelChecks(fuel.map((f) => ({ ...f, liters: Number(f.liters) })));

  const recent = [
    ...(recentRes.data ?? []).map((e) => ({
      key: `e-${e.id}`,
      at: e.reviewed_at,
      who: (e as unknown as Joined).driver?.full_name,
      what: (e as unknown as Joined).category?.name_ar ?? "مصروف",
      amount: formatMoney(e.amount_minor, e.currency),
      status: e.status,
      reason: e.rejection_reason,
    })),
    ...(recentFuelRes.data ?? []).map((f) => ({
      key: `f-${f.id}`,
      at: f.reviewed_at,
      who: (f as unknown as Joined).driver?.full_name,
      what: `ديزل · ${formatDecimal(Number(f.liters))} لتر`,
      amount: formatMoney(f.amount_minor, f.currency),
      status: f.status,
      reason: f.rejection_reason,
    })),
  ]
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
    .slice(0, 15);

  return (
    <>
      <PageHeader title="الموافقات" subtitle="مصاريف وتعبئات ديزل أرسلها السائقون ولم تُحتسب بعد" />
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="مصاريف بانتظار الموافقة" subtitle={`${pending.length} مصروف`} />
          {pending.length === 0 ? (
            <EmptyState>لا توجد مصاريف بانتظار الموافقة.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {pending.map((e) => {
                const j = e as unknown as Joined;
                return (
                  <li key={e.id} className="flex flex-col gap-4 p-4 sm:flex-row" data-expense-id={e.id}>
                    <div className="shrink-0">
                      <Receipt href={e.receipt_path ? `/files/expense/${e.id}` : null} alt={`إيصال ${j.category?.name_ar ?? ""}`} />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 text-sm">
                          <p className="font-semibold">
                            {j.category?.name_ar} · <span className="num">{formatMoney(e.amount_minor, e.currency)}</span>
                          </p>
                          <Who j={j} />
                          <p className="text-muted">
                            <span className="num">{formatDate(e.expense_date)}</span> · {PAYMENT_METHOD[e.payment_method ?? ""] ?? e.payment_method}
                          </p>
                          {e.description ? <p>{e.description}</p> : null}
                        </div>
                        <p className="text-xs text-muted">
                          أُرسل <span className="num">{formatDateTime(e.created_at)}</span>
                        </p>
                      </div>
                      <ExpenseReview
                        approve={approveExpense.bind(null, e.id)}
                        reject={rejectExpense.bind(null, e.id)}
                        categories={categories}
                        initial={{
                          category_id: e.category_id,
                          amount: formatMoney(e.amount_minor, e.currency, { withCurrency: false }),
                          currency: e.currency,
                          fx_rate: String(e.fx_rate),
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="ديزل بانتظار الموافقة" subtitle={`${fuel.length} تعبئة`} />
          {fuel.length === 0 ? (
            <EmptyState>لا توجد تعبئات بانتظار الموافقة.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {fuel.map((f) => {
                const j = f as unknown as Joined;
                const liters = Number(f.liters);
                const check = checks.get(f.id);
                const perLiter = pricePerLiter(f.amount_minor, liters);
                return (
                  <li key={f.id} className="flex flex-col gap-4 p-4 sm:flex-row" data-fillup-id={f.id}>
                    <div className="shrink-0">
                      <Receipt href={f.receipt_path ? `/files/fuel/${f.id}` : null} alt="إيصال تعبئة ديزل" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 text-sm">
                          <p className="font-semibold">
                            ديزل <span className="num">{formatDecimal(liters)}</span> لتر ·{" "}
                            <span className="num">{formatMoney(f.amount_minor, f.currency)}</span>
                          </p>
                          <Who j={j} />
                          <p className="text-muted">
                            <span className="num">{formatDateTime(f.filled_at)}</span> · العداد <span className="num">{formatInt(f.odometer)}</span>
                            {f.is_full_tank ? "" : " · جزئية"}
                            {j.station ? ` · ${j.station.name}` : ""} · {PAYMENT_METHOD[f.payment_method] ?? f.payment_method}
                          </p>
                          <p className="text-muted">
                            سعر اللتر <span className="num">{perLiter !== null ? formatMoney(perLiter, f.currency) : "—"}</span>
                            {" · "}
                            {check?.kmPerLiter != null ? (
                              <span className={check.abnormal ? "font-semibold text-danger" : ""}>
                                <span className="num">{formatDecimal(check.kmPerLiter)}</span> كم/لتر
                                {check.baseline != null ? (
                                  <>
                                    {" "}
                                    (المعتاد <span className="num">{formatDecimal(check.baseline)}</span>)
                                  </>
                                ) : null}
                              </span>
                            ) : (
                              "لا يمكن حساب كم/لتر لهذه التعبئة"
                            )}
                          </p>
                          {check?.abnormal ? (
                            <p className="mt-1 flex items-center gap-1 text-xs font-medium text-danger">
                              <AlertTriangle className="size-3.5" aria-hidden />
                              استهلاك أعلى من المعتاد؛ راجع الإيصال والعداد قبل الاعتماد
                            </p>
                          ) : null}
                          {f.notes ? <p>{f.notes}</p> : null}
                        </div>
                        <p className="text-xs text-muted">
                          أُرسلت <span className="num">{formatDateTime(f.created_at)}</span>
                        </p>
                      </div>
                      <FuelReview
                        approve={approveFillup.bind(null, f.id)}
                        reject={rejectFillup.bind(null, f.id)}
                        initial={{
                          liters: String(liters),
                          amount: formatMoney(f.amount_minor, f.currency, { withCurrency: false }),
                          odometer: String(f.odometer),
                          is_full_tank: f.is_full_tank,
                          currency: f.currency,
                          fx_rate: String(f.fx_rate),
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="تمت مراجعتها مؤخراً" subtitle="آخر 15" />
          {recent.length === 0 ? (
            <EmptyState>لا يوجد.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>المراجعة</Th>
                  <Th>السائق</Th>
                  <Th>البند</Th>
                  <Th className="text-end">المبلغ</Th>
                  <Th>الحالة</Th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => {
                  const st = EXPENSE_STATUS[r.status];
                  return (
                    <Tr key={r.key}>
                      <Td className="num whitespace-nowrap">{formatDateTime(r.at)}</Td>
                      <Td>{r.who}</Td>
                      <Td>{r.what}</Td>
                      <Td className="num text-end whitespace-nowrap">{r.amount}</Td>
                      <Td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {r.reason ? <span className="block text-xs text-muted">{r.reason}</span> : null}
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
