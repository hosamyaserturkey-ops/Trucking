import type { Metadata } from "next";
import Link from "next/link";
import { Printer } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { statementFilter } from "@/lib/ledger";
import { formatMoney, sumMinor } from "@/lib/money";
import { formatDate, formatInt } from "@/lib/format";
import { ISSUED_CHEQUE_STATUS, SUPPLIER_PAYMENT_METHOD } from "@/lib/labels";
import { deleteSupplierPayment, saveSupplierPayment, setIssuedChequeStatus } from "./actions";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { ExportButton } from "@/components/export-button";
import { DeletePaymentButton, IssuedChequeStatusForm, SupplierPaymentForm } from "@/components/supplier-payment-forms";

export const metadata: Metadata = { title: "دفعات الموردين" };

type SearchParams = Promise<{ from?: string; to?: string; supplier?: string; method?: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD = "rounded-lg border border-border bg-surface px-3 py-2 text-sm";

/** Payments to suppliers (cash, transfers, cheques we issue, discounts), and issued cheques not paid yet. */
export default async function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(...FINANCE_ROLES);
  const sp = await searchParams;
  const f = statementFilter(sp);
  const supplier = sp.supplier && UUID.test(sp.supplier) ? sp.supplier : "";
  const method = sp.method && SUPPLIER_PAYMENT_METHOD[sp.method] ? sp.method : "";
  const today = todayIso();
  const supabase = await createClient();

  const fields =
    "id, payment_no, paid_on, method, amount_minor, voucher_no, reference_no, cheque_no, cheque_bank, cheque_due_date, cheque_status, cheque_status_on, notes, supplier:suppliers(id, name)";
  let q = supabase
    .from("supplier_payments")
    .select(fields)
    .gte("paid_on", f.from)
    .lte("paid_on", f.to)
    .order("paid_on", { ascending: false })
    .order("payment_no", { ascending: false })
    .limit(500);
  if (supplier) q = q.eq("supplier_id", supplier);
  if (method) q = q.eq("method", method);
  const [rowsRes, chequesRes, suppliersRes] = await Promise.all([
    q,
    supabase.from("supplier_payments").select(fields).eq("cheque_status", "issued").order("cheque_due_date").limit(300),
    supabase.from("supplier_balance_v").select("supplier_id, name, is_active, balance_minor").order("name"),
  ]);
  const rows = rowsRes.data ?? [];
  const cheques = chequesRes.data ?? [];
  const suppliers = (suppliersRes.data ?? [])
    .filter((s) => s.is_active || s.supplier_id === supplier)
    .map((s) => ({
      id: s.supplier_id as string,
      label: s.name as string,
      owed: Number(s.balance_minor) > 0 ? formatMoney(Number(s.balance_minor), "JOD") : null,
    }));
  const byMethod = (m: string) => sumMinor(rows.filter((r) => r.method === m && r.cheque_status !== "bounced").map((r) => r.amount_minor));
  const dueSoon = cheques.filter((c) => (c.cheque_due_date ?? "") <= today).length;

  return (
    <>
      <PageHeader
        title="دفعات الموردين"
        subtitle={`سندات الصرف للموردين من ${formatDate(f.from)} إلى ${formatDate(f.to)} · المبالغ بالدينار`}
        action={
          <Link href="/payables" className={buttonClass("secondary")}>
            ذمم الموردين
          </Link>
        }
      />
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="دفعة جديدة لمورد" subtitle="تُرحّل تلقائياً: مدين حساب المورد، دائن الصندوق أو البنك أو الشيكات المؤجلة" />
          <CardBody>
            <SupplierPaymentForm action={saveSupplierPayment} suppliers={suppliers} today={today} supplierId={supplier || undefined} />
          </CardBody>
        </Card>

        <StatGrid>
          <Stat label="نقداً" value={formatMoney(byMethod("cash"), "JOD", { fractionDigits: 0 })} />
          <Stat label="تحويلات" value={formatMoney(byMethod("bank"), "JOD", { fractionDigits: 0 })} />
          <Stat label="شيكات" value={formatMoney(byMethod("cheque"), "JOD", { fractionDigits: 0 })} hint="عدا المرتجعة" />
          <Stat
            label="شيكات بانتظار الصرف"
            value={formatMoney(sumMinor(cheques.map((c) => c.amount_minor)), "JOD", { fractionDigits: 0 })}
            hint={`${formatInt(cheques.length)} شيك${dueSoon ? ` · ${formatInt(dueSoon)} مستحق` : ""}`}
            tone={dueSoon ? "warning" : "neutral"}
          />
        </StatGrid>

        <Card>
          <CardHeader title="شيكات صادرة بانتظار الصرف" subtitle="الأقرب استحقاقاً أولاً؛ أمّن رصيد البنك قبل الاستحقاق" action={<ExportButton tableId="issued-cheques-table" file="issued-cheques" title={`شيكات صادرة بانتظار الصرف في ${formatDate(today)}`} />} />
          {cheques.length === 0 ? (
            <EmptyState>لا توجد شيكات صادرة بانتظار الصرف.</EmptyState>
          ) : (
            <Table id="issued-cheques-table">
              <thead>
                <tr>
                  <Th>الاستحقاق</Th>
                  <Th>المورد</Th>
                  <Th>رقم الشيك</Th>
                  <Th>البنك</Th>
                  <Th className="text-end">المبلغ</Th>
                  <Th>تغيير الحالة</Th>
                </tr>
              </thead>
              <tbody>
                {cheques.map((c) => {
                  const due = (c.cheque_due_date ?? "") <= today;
                  return (
                    <Tr key={c.id}>
                      <Td className={`num whitespace-nowrap ${due ? "font-semibold text-warning" : ""}`}>{formatDate(c.cheque_due_date)}</Td>
                      <Td className="whitespace-nowrap">{(c.supplier as { name: string } | null)?.name}</Td>
                      <Td className="num">
                        <span dir="ltr">{c.cheque_no}</span>
                      </Td>
                      <Td className="whitespace-nowrap">{c.cheque_bank ?? "—"}</Td>
                      <Td className="num whitespace-nowrap text-end">{formatMoney(c.amount_minor, "JOD", { withCurrency: false })}</Td>
                      <Td>
                        <IssuedChequeStatusForm action={setIssuedChequeStatus.bind(null, c.id)} status={c.cheque_status ?? "issued"} today={today} />
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <form action="/payments" className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1 text-xs text-muted">
            المورد
            <select name="supplier" defaultValue={supplier} className={FIELD}>
              <option value="">الكل</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            الطريقة
            <select name="method" defaultValue={method} className={FIELD}>
              <option value="">الكل</option>
              {Object.entries(SUPPLIER_PAYMENT_METHOD).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            من
            <input type="date" name="from" defaultValue={f.from} className={FIELD} dir="ltr" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            إلى
            <input type="date" name="to" defaultValue={f.to} className={FIELD} dir="ltr" />
          </label>
          <button type="submit" className={buttonClass("secondary")}>
            عرض
          </button>
        </form>

        <Card>
          <CardHeader title="دفعات الموردين" subtitle={`${formatInt(rows.length)} دفعة`} action={<ExportButton tableId="payments-table" file="supplier-payments" title={`دفعات الموردين من ${formatDate(f.from)} إلى ${formatDate(f.to)} · المبالغ بالدينار`} />} />
          {rows.length === 0 ? (
            <EmptyState>لا توجد دفعات للموردين في هذه الفترة.</EmptyState>
          ) : (
            <Table id="payments-table">
              <thead>
                <tr>
                  <Th>رقم الدفعة</Th>
                  <Th>التاريخ</Th>
                  <Th>المورد</Th>
                  <Th>الطريقة</Th>
                  <Th>التفاصيل</Th>
                  <Th className="text-end">المبلغ</Th>
                  <Th>
                    <span className="sr-only">إجراءات</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = r.supplier as { id: string; name: string } | null;
                  const st = r.cheque_status ? ISSUED_CHEQUE_STATUS[r.cheque_status] : null;
                  return (
                    <Tr key={r.id} className={r.cheque_status === "bounced" ? "text-muted" : ""}>
                      <Td className="num font-semibold">{r.payment_no}</Td>
                      <Td className="num whitespace-nowrap">{formatDate(r.paid_on)}</Td>
                      <Td className="whitespace-nowrap">
                        {s ? (
                          <Link href={`/payments?supplier=${s.id}&from=${f.from}&to=${f.to}`} className="hover:underline">
                            {s.name}
                          </Link>
                        ) : null}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {SUPPLIER_PAYMENT_METHOD[r.method]}
                        {st ? (
                          <span className="ms-1">
                            <Badge tone={st.tone}>{st.label}</Badge>
                          </span>
                        ) : null}
                      </Td>
                      <Td className="text-xs">
                        {r.voucher_no ? (
                          <span className="block">
                            سند صرف <span className="num" dir="ltr">{r.voucher_no}</span>
                          </span>
                        ) : null}
                        {r.method === "cheque" ? (
                          <span className="block">
                            شيك <span className="num" dir="ltr">{r.cheque_no}</span>
                            {r.cheque_bank ? ` · ${r.cheque_bank}` : ""} · يستحق <span className="num">{formatDate(r.cheque_due_date)}</span>
                          </span>
                        ) : r.reference_no ? (
                          <span className="num block" dir="ltr">
                            {r.reference_no}
                          </span>
                        ) : null}
                        {r.notes ? <span className="block text-muted">{r.notes}</span> : null}
                      </Td>
                      <Td className="num whitespace-nowrap text-end font-semibold">{formatMoney(r.amount_minor, "JOD", { withCurrency: false })}</Td>
                      <Td className="whitespace-nowrap">
                        <Link href={`/print/payments/${r.id}`} target="_blank" className="me-3 inline-flex text-muted hover:text-text">
                          <Printer className="size-4" aria-label="طباعة سند الصرف" />
                        </Link>
                        <DeletePaymentButton action={deleteSupplierPayment.bind(null, r.id)} />
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
