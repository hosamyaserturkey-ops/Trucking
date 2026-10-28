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
import { CHEQUE_STATUS, RECEIPT_METHOD } from "@/lib/labels";
import { deleteReceipt, saveReceipt, setChequeStatus } from "./actions";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { ChequeStatusForm, DeleteReceiptButton, ReceiptForm } from "@/components/receipt-forms";

export const metadata: Metadata = { title: "المقبوضات" };

type SearchParams = Promise<{ from?: string; to?: string; client?: string; method?: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD = "rounded-lg border border-border bg-surface px-3 py-2 text-sm";

/** Receipts from customers (cash, transfers, cheques, discounts), and cheques waiting to be collected. */
export default async function ReceiptsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(...FINANCE_ROLES);
  const sp = await searchParams;
  const f = statementFilter(sp);
  const client = sp.client && UUID.test(sp.client) ? sp.client : "";
  const method = sp.method && RECEIPT_METHOD[sp.method] ? sp.method : "";
  const today = todayIso();
  const supabase = await createClient();

  const fields = "id, receipt_no, received_on, method, amount_minor, reference_no, cheque_no, cheque_bank, cheque_due_date, cheque_status, cheque_status_on, notes, client:clients(id, name)";
  let q = supabase
    .from("client_receipts")
    .select(fields)
    .gte("received_on", f.from)
    .lte("received_on", f.to)
    .order("received_on", { ascending: false })
    .order("receipt_no", { ascending: false })
    .limit(500);
  if (client) q = q.eq("client_id", client);
  if (method) q = q.eq("method", method);
  const [rowsRes, chequesRes, clientsRes] = await Promise.all([
    q,
    supabase.from("client_receipts").select(fields).in("cheque_status", ["in_hand", "deposited"]).order("cheque_due_date").limit(300),
    supabase.from("clients").select("id, name").eq("is_active", true).order("name"),
  ]);
  const rows = rowsRes.data ?? [];
  const cheques = chequesRes.data ?? [];
  const clients = (clientsRes.data ?? []).map((c) => ({ id: c.id, label: c.name }));
  const byMethod = (m: string) => sumMinor(rows.filter((r) => r.method === m && r.cheque_status !== "bounced").map((r) => r.amount_minor));
  const dueSoon = cheques.filter((c) => (c.cheque_due_date ?? "") <= today).length;

  return (
    <>
      <PageHeader title="المقبوضات" subtitle={`سندات القبض من ${formatDate(f.from)} إلى ${formatDate(f.to)} · المبالغ بالدينار`} />
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="سند قبض جديد" subtitle="يُرحّل تلقائياً: مدين الصندوق أو البنك أو الشيكات، دائن حساب الزبون" />
          <CardBody>
            <ReceiptForm action={saveReceipt} clients={clients} today={today} clientId={client || undefined} />
          </CardBody>
        </Card>

        <StatGrid>
          <Stat label="نقداً" value={formatMoney(byMethod("cash"), "JOD", { fractionDigits: 0 })} />
          <Stat label="تحويلات" value={formatMoney(byMethod("bank"), "JOD", { fractionDigits: 0 })} />
          <Stat label="شيكات" value={formatMoney(byMethod("cheque"), "JOD", { fractionDigits: 0 })} hint="عدا المرتجعة" />
          <Stat
            label="شيكات برسم التحصيل"
            value={formatMoney(sumMinor(cheques.map((c) => c.amount_minor)), "JOD", { fractionDigits: 0 })}
            hint={`${formatInt(cheques.length)} شيك${dueSoon ? ` · ${formatInt(dueSoon)} مستحق` : ""}`}
            tone={dueSoon ? "warning" : "neutral"}
          />
        </StatGrid>

        <Card>
          <CardHeader title="شيكات برسم التحصيل" subtitle="بالصندوق أو مودعة، الأقرب استحقاقاً أولاً" />
          {cheques.length === 0 ? (
            <EmptyState>لا توجد شيكات بانتظار التحصيل.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>الاستحقاق</Th>
                  <Th>الزبون</Th>
                  <Th>رقم الشيك</Th>
                  <Th>البنك</Th>
                  <Th className="text-end">المبلغ</Th>
                  <Th>الحالة</Th>
                  <Th>تغيير الحالة</Th>
                </tr>
              </thead>
              <tbody>
                {cheques.map((c) => {
                  const st = CHEQUE_STATUS[c.cheque_status ?? "in_hand"];
                  const due = (c.cheque_due_date ?? "") <= today;
                  return (
                    <Tr key={c.id}>
                      <Td className={`num whitespace-nowrap ${due ? "font-semibold text-warning" : ""}`}>{formatDate(c.cheque_due_date)}</Td>
                      <Td className="whitespace-nowrap">{(c.client as { name: string } | null)?.name}</Td>
                      <Td className="num">
                        <span dir="ltr">{c.cheque_no}</span>
                      </Td>
                      <Td className="whitespace-nowrap">{c.cheque_bank ?? "—"}</Td>
                      <Td className="num whitespace-nowrap text-end">{formatMoney(c.amount_minor, "JOD", { withCurrency: false })}</Td>
                      <Td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </Td>
                      <Td>
                        <ChequeStatusForm action={setChequeStatus.bind(null, c.id)} status={c.cheque_status ?? "in_hand"} today={today} />
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <form action="/receipts" className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1 text-xs text-muted">
            الزبون
            <select name="client" defaultValue={client} className={FIELD}>
              <option value="">الكل</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            الطريقة
            <select name="method" defaultValue={method} className={FIELD}>
              <option value="">الكل</option>
              {Object.entries(RECEIPT_METHOD).map(([value, label]) => (
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
          <CardHeader title="سندات القبض" subtitle={`${formatInt(rows.length)} سند`} />
          {rows.length === 0 ? (
            <EmptyState>لا توجد سندات قبض في هذه الفترة.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>رقم السند</Th>
                  <Th>التاريخ</Th>
                  <Th>الزبون</Th>
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
                  const c = r.client as { id: string; name: string } | null;
                  const st = r.cheque_status ? CHEQUE_STATUS[r.cheque_status] : null;
                  return (
                    <Tr key={r.id} className={r.cheque_status === "bounced" ? "text-muted" : ""}>
                      <Td className="num font-semibold">{r.receipt_no}</Td>
                      <Td className="num whitespace-nowrap">{formatDate(r.received_on)}</Td>
                      <Td className="whitespace-nowrap">
                        {c ? (
                          <Link href={`/receivables/${c.id}`} className="hover:underline">
                            {c.name}
                          </Link>
                        ) : null}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {RECEIPT_METHOD[r.method]}
                        {st ? (
                          <span className="ms-1">
                            <Badge tone={st.tone}>{st.label}</Badge>
                          </span>
                        ) : null}
                      </Td>
                      <Td className="text-xs">
                        {r.method === "cheque" ? (
                          <>
                            شيك <span className="num" dir="ltr">{r.cheque_no}</span>
                            {r.cheque_bank ? ` · ${r.cheque_bank}` : ""} · يستحق <span className="num">{formatDate(r.cheque_due_date)}</span>
                          </>
                        ) : r.reference_no ? (
                          <span className="num" dir="ltr">
                            {r.reference_no}
                          </span>
                        ) : null}
                        {r.notes ? <span className="block text-muted">{r.notes}</span> : null}
                      </Td>
                      <Td className="num whitespace-nowrap text-end font-semibold">{formatMoney(r.amount_minor, "JOD", { withCurrency: false })}</Td>
                      <Td className="whitespace-nowrap">
                        <Link href={`/print/receipts/${r.id}`} target="_blank" className="me-3 inline-flex text-muted hover:text-text">
                          <Printer className="size-4" aria-label="طباعة السند" />
                        </Link>
                        <DeleteReceiptButton action={deleteReceipt.bind(null, r.id)} />
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
