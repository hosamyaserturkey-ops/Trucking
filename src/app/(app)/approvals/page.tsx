import type { Metadata } from "next";
import Link from "next/link";
import { FileX2 } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { EXPENSE_STATUS, PAYMENT_METHOD } from "@/lib/labels";
import { approveExpense, rejectExpense } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { ExpenseReview } from "@/components/expense-review";

export const metadata: Metadata = { title: "الموافقات" };

const EXPENSE_FIELDS =
  "id, expense_date, description, currency, amount_minor, amount_base_minor, fx_rate, payment_method, status, rejection_reason, receipt_path, created_at, reviewed_at, category_id, category:expense_categories(name_ar), driver:drivers(id, full_name), truck:trucks(id, code), trip:trips(id, trip_no)";

type Joined = {
  category: { name_ar: string } | null;
  driver: { id: string; full_name: string } | null;
  truck: { id: string; code: string } | null;
  trip: { id: string; trip_no: number } | null;
};

// Driver expenses wait here until the accountant or manager approves or rejects them.
export default async function ApprovalsPage() {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();

  const [pendingRes, recentRes, catsRes] = await Promise.all([
    supabase.from("expenses").select(EXPENSE_FIELDS).eq("status", "submitted").order("created_at"),
    supabase
      .from("expenses")
      .select(EXPENSE_FIELDS)
      .not("reviewed_at", "is", null)
      .order("reviewed_at", { ascending: false })
      .limit(15),
    supabase.from("expense_categories").select("id, name_ar").eq("is_active", true).order("sort_order"),
  ]);
  const pending = pendingRes.data ?? [];
  const recent = recentRes.data ?? [];
  const categories = (catsRes.data ?? []).map((c) => ({ id: c.id, label: c.name_ar }));

  return (
    <>
      <PageHeader title="الموافقات" subtitle="مصاريف أرسلها السائقون ولم تُحتسب بعد" />
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="بانتظار الموافقة" subtitle={`${pending.length} مصروف`} />
          {pending.length === 0 ? (
            <EmptyState>لا توجد مصاريف بانتظار الموافقة.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {pending.map((e) => {
                const j = e as unknown as Joined;
                // Opened through /files/…: RLS decides, and each view gets a fresh short-lived link.
                const url = e.receipt_path ? `/files/expense/${e.id}` : undefined;
                return (
                  <li key={e.id} className="flex flex-col gap-4 p-4 sm:flex-row" data-expense-id={e.id}>
                    <div className="shrink-0">
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" title="فتح الإيصال بالحجم الكامل">
                          {/* eslint-disable-next-line @next/next/no-img-element -- private file behind /files/ */}
                          <img
                            src={url}
                            alt={`إيصال ${j.category?.name_ar ?? ""}`}
                            className="h-32 w-28 rounded-lg border border-border bg-surface-2 object-cover"
                          />
                        </a>
                      ) : (
                        <div className="flex h-32 w-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-xs text-muted">
                          <FileX2 className="size-5" aria-hidden />
                          بلا إيصال
                        </div>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 text-sm">
                          <p className="font-semibold">
                            {j.category?.name_ar} · <span className="num">{formatMoney(e.amount_minor, e.currency)}</span>
                          </p>
                          <p className="text-muted">
                            {j.driver?.full_name ?? "—"}
                            {j.truck ? (
                              <>
                                {" "}
                                ·{" "}
                                <Link href={`/trucks/${j.truck.id}/expenses`} className="num hover:underline">
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
          <CardHeader title="تمت مراجعتها مؤخراً" subtitle="آخر 15 مصروفاً" />
          {recent.length === 0 ? (
            <EmptyState>لا يوجد.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>المراجعة</Th>
                  <Th>السائق</Th>
                  <Th>النوع</Th>
                  <Th className="text-end">المبلغ</Th>
                  <Th>الحالة</Th>
                </tr>
              </thead>
              <tbody>
                {recent.map((e) => {
                  const j = e as unknown as Joined;
                  const st = EXPENSE_STATUS[e.status];
                  return (
                    <Tr key={e.id}>
                      <Td className="num whitespace-nowrap">{formatDateTime(e.reviewed_at)}</Td>
                      <Td>{j.driver?.full_name}</Td>
                      <Td>{j.category?.name_ar}</Td>
                      <Td className="num text-end whitespace-nowrap">{formatMoney(e.amount_minor, e.currency)}</Td>
                      <Td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {e.rejection_reason ? <span className="block text-xs text-muted">{e.rejection_reason}</span> : null}
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
