import Link from "next/link";
import type { Metadata } from "next";
import { Paperclip, Plus } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { canSeeFinancials, STAFF_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { inclusiveEnd, resolveRange } from "@/lib/date-range";
import { formatMoney, sumMinor } from "@/lib/money";
import { formatDate, formatInt } from "@/lib/format";
import { EXPENSE_STATUS, PAYMENT_METHOD } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { buttonClass, LinkButton } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";

export const metadata: Metadata = { title: "المصاريف" };

type SearchParams = Promise<{
  scope?: string;
  truck?: string;
  category?: string;
  status?: string;
  payment?: string;
  from?: string;
  to?: string;
  saved?: string;
}>;

const UUID = /^[0-9a-f-]{36}$/i;

export default async function ExpensesPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireRole(...STAFF_ROLES);
  const finance = canSeeFinancials(profile.role);
  const sp = await searchParams;
  const range = sp.from && sp.to ? resolveRange({ range: "custom", from: sp.from, to: sp.to }) : resolveRange({ range: "month" });
  const scope = sp.scope === "truck" || sp.scope === "overhead" ? sp.scope : "";
  const truck = sp.truck && UUID.test(sp.truck) ? sp.truck : "";
  const category = sp.category && UUID.test(sp.category) ? sp.category : "";
  const status = sp.status && EXPENSE_STATUS[sp.status] ? sp.status : "";
  const payment = sp.payment && PAYMENT_METHOD[sp.payment] ? sp.payment : "";

  const supabase = await createClient();
  let query = supabase
    .from("expenses")
    .select(
      "id, expense_date, cost_scope, description, currency, amount_minor, amount_base_minor, payment_method, reference_no, voucher_no, customs_declaration_no, status, receipt_path, settlement_id, truck:trucks(id, code), driver:drivers(full_name), category:expense_categories(name_ar)",
    )
    .gte("expense_date", range.from)
    .lt("expense_date", range.to)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(400);
  if (scope) query = query.eq("cost_scope", scope);
  if (truck) query = query.eq("truck_id", truck);
  if (category) query = query.eq("category_id", category);
  if (status) query = query.eq("status", status);
  if (payment) query = query.eq("payment_method", payment);

  const [expensesRes, trucksRes, catsRes] = await Promise.all([
    query,
    supabase.from("trucks").select("id, code").order("code"),
    supabase.from("expense_categories").select("id, name_ar").order("sort_order"),
  ]);
  const rows = expensesRes.data ?? [];
  const approved = rows.filter((r) => r.status === "approved");
  const truckTotal = sumMinor(approved.filter((r) => r.cost_scope === "truck").map((r) => r.amount_base_minor));
  const overheadTotal = sumMinor(approved.filter((r) => r.cost_scope === "overhead").map((r) => r.amount_base_minor));
  const waiting = rows.filter((r) => r.status === "submitted").length;
  const select = "rounded-lg border border-border bg-surface px-3 py-2 text-sm";

  return (
    <>
      <PageHeader
        title="المصاريف"
        subtitle={`${formatInt(rows.length)} مصروف · من ${range.from} إلى ${inclusiveEnd(range)}`}
        action={
          finance ? (
            <div className="flex flex-wrap gap-2">
              <LinkButton href={`/ledger/expenses?from=${range.from}&to=${inclusiveEnd(range)}`} variant="secondary">
                كشف حساب المصاريف
              </LinkButton>
              <LinkButton href="/expenses/new" variant="primary">
                <Plus className="size-4" aria-hidden />
                مصروف جديد
              </LinkButton>
            </div>
          ) : null
        }
      />

      <form action="/expenses" className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1 text-xs text-muted">
          التحميل
          <select name="scope" defaultValue={scope} className={select}>
            <option value="">الكل</option>
            <option value="truck">على شاحنة</option>
            <option value="overhead">عام</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          الشاحنة
          <select name="truck" defaultValue={truck} className={select}>
            <option value="">الكل</option>
            {(trucksRes.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.code}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          النوع
          <select name="category" defaultValue={category} className={select}>
            <option value="">الكل</option>
            {(catsRes.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name_ar}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          الحالة
          <select name="status" defaultValue={status} className={select}>
            <option value="">الكل</option>
            {Object.entries(EXPENSE_STATUS).map(([value, s]) => (
              <option key={value} value={value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          الدفع
          <select name="payment" defaultValue={payment} className={select}>
            <option value="">الكل</option>
            {["cash", "bank", "check", "credit", "driver_advance"].map((p) => (
              <option key={p} value={p}>
                {PAYMENT_METHOD[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          من
          <input type="date" name="from" defaultValue={range.from} className={select} dir="ltr" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          إلى
          <input type="date" name="to" defaultValue={inclusiveEnd(range)} className={select} dir="ltr" />
        </label>
        <button type="submit" className={buttonClass("secondary")}>
          عرض
        </button>
      </form>

      <div className="flex flex-col gap-5">
        {sp.saved ? (
          <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
            تم حفظ المصروف.
          </p>
        ) : null}
        <StatGrid>
          <Stat label="مصاريف الشاحنات (معتمدة)" value={formatMoney(truckTotal, "JOD", { fractionDigits: 0 })} />
          <Stat label="مصاريف عامة (معتمدة)" value={formatMoney(overheadTotal, "JOD", { fractionDigits: 0 })} hint="تُوزّع على الأسطول" />
          <Stat label="بانتظار الموافقة" value={formatInt(waiting)} tone={waiting ? "warning" : "neutral"} />
          <Stat label="عدد المصاريف" value={formatInt(rows.length)} />
        </StatGrid>

        <Card>
          <CardHeader title="سجل المصاريف" subtitle="آخر 400 في الفترة" />
          {rows.length === 0 ? (
            <EmptyState>لا توجد مصاريف.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>التاريخ</Th>
                  <Th>النوع</Th>
                  <Th>البيان</Th>
                  <Th>التحميل</Th>
                  <Th>السائق</Th>
                  <Th>سند الصرف</Th>
                  <Th>البيان الجمركي</Th>
                  <Th className="text-end">المبلغ</Th>
                  <Th className="text-end">بالدينار</Th>
                  <Th>الدفع</Th>
                  <Th>الحالة</Th>
                  <Th>
                    <span className="sr-only">إجراءات</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const st = EXPENSE_STATUS[e.status];
                  const t = e.truck as { id: string; code: string } | null;
                  // Waiting ones are reviewed in Approvals; rejected and settled ones are closed.
                  const editable = finance && !e.settlement_id && e.status === "approved";
                  return (
                    <Tr key={e.id}>
                      <Td className="num whitespace-nowrap">{formatDate(e.expense_date)}</Td>
                      <Td className="whitespace-nowrap">{(e.category as { name_ar: string } | null)?.name_ar}</Td>
                      <Td>
                        {e.description}
                        {e.reference_no ? <span className="block text-xs text-muted" dir="ltr">{e.reference_no}</span> : null}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {t ? (
                          <Link href={`/trucks/${t.id}/expenses`} className="num hover:underline">
                            {t.code}
                          </Link>
                        ) : (
                          <Badge>عام</Badge>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">{(e.driver as { full_name: string } | null)?.full_name ?? "—"}</Td>
                      <Td className="num whitespace-nowrap">
                        <span dir="ltr">{e.voucher_no ?? ""}</span>
                      </Td>
                      <Td className="num whitespace-nowrap">
                        {e.customs_declaration_no ? (
                          <Link href={`/customs?q=${encodeURIComponent(e.customs_declaration_no)}`} className="hover:underline" dir="ltr">
                            {e.customs_declaration_no}
                          </Link>
                        ) : null}
                      </Td>
                      <Td className="num text-end whitespace-nowrap">{formatMoney(e.amount_minor, e.currency)}</Td>
                      <Td className="num text-end whitespace-nowrap">{formatMoney(e.amount_base_minor, "JOD", { withCurrency: false })}</Td>
                      <Td className="whitespace-nowrap">{PAYMENT_METHOD[e.payment_method ?? ""] ?? e.payment_method}</Td>
                      <Td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {e.receipt_path ? (
                          <a href={`/files/expense/${e.id}`} target="_blank" rel="noreferrer" className="me-2 inline-flex text-muted hover:text-text">
                            <Paperclip className="size-4" aria-label="الإيصال" />
                          </a>
                        ) : null}
                        {editable ? (
                          <Link href={`/expenses/${e.id}/edit`} className="text-xs text-primary hover:underline">
                            تعديل
                          </Link>
                        ) : null}
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
