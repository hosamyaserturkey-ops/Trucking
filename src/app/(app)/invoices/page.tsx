import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { statementFilter } from "@/lib/ledger";
import { formatMoney, sumMinor } from "@/lib/money";
import { formatDate, formatInt } from "@/lib/format";
import { INVOICE_STATUS } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { buttonClass, LinkButton } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { ExportButton } from "@/components/export-button";

export const metadata: Metadata = { title: "الفواتير" };

type SearchParams = Promise<{ from?: string; to?: string; client?: string; status?: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD = "rounded-lg border border-border bg-surface px-3 py-2 text-sm";

export default async function InvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(...FINANCE_ROLES);
  const sp = await searchParams;
  // This year so far by default.
  const f = statementFilter(sp.from && sp.to ? sp : { from: `${new Date().getFullYear()}-01-01`, to: statementFilter({}).to });
  const client = sp.client && UUID.test(sp.client) ? sp.client : "";
  const status = sp.status && INVOICE_STATUS[sp.status] ? sp.status : "";

  const supabase = await createClient();
  let q = supabase
    .from("invoices")
    .select("id, invoice_no, invoice_date, due_date, period_from, period_to, lines_count, subtotal_minor, vat_minor, total_minor, status, client:clients(name), einvoices(kind, status, last_error)")
    .gte("invoice_date", f.from)
    .lte("invoice_date", f.to)
    .order("invoice_date", { ascending: false })
    .order("invoice_no", { ascending: false })
    .limit(500);
  if (client) q = q.eq("client_id", client);
  if (status) q = q.eq("status", status);
  const [invRes, clientsRes, unbilledRes] = await Promise.all([
    q,
    supabase.from("clients").select("id, name").order("name"),
    supabase.from("client_balance_v").select("unbilled_loads, unbilled_minor").gt("unbilled_loads", 0),
  ]);
  const rows = invRes.data ?? [];
  const issued = rows.filter((r) => r.status === "issued");
  const einvoice = (r: (typeof rows)[number]) => {
    const docs = (r.einvoices ?? []) as { kind: string; status: string; last_error: string | null }[];
    const inv = docs.find((d) => d.kind === "invoice");
    const credit = docs.find((d) => d.kind === "credit_note");
    if (r.status === "cancelled") {
      if (inv?.status !== "submitted") return null;
      return credit?.status === "submitted" ? { label: "أُرسل الإرجاع", tone: "neutral" as const } : { label: "إرجاع لم يُرسل", tone: "danger" as const };
    }
    if (inv?.status === "submitted") return { label: "مقبولة", tone: "success" as const };
    return inv?.last_error ? { label: "مرفوضة", tone: "danger" as const } : { label: "لم تُرسل", tone: "warning" as const };
  };
  const unsent = rows.filter((r) => einvoice(r)?.tone === "warning" || einvoice(r)?.tone === "danger").length;
  const unbilledLoads = (unbilledRes.data ?? []).reduce((s, r) => s + (r.unbilled_loads ?? 0), 0);
  const unbilledMinor = sumMinor((unbilledRes.data ?? []).map((r) => r.unbilled_minor));

  return (
    <>
      <PageHeader
        title="الفواتير"
        subtitle={`${formatInt(rows.length)} فاتورة من ${formatDate(f.from)} إلى ${formatDate(f.to)}`}
        action={
          <LinkButton href="/invoices/new" variant="primary">
            <Plus className="size-4" aria-hidden />
            فاتورة جديدة
          </LinkButton>
        }
      />
      <form action="/invoices" className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1 text-xs text-muted">
          الزبون
          <select name="client" defaultValue={client} className={FIELD}>
            <option value="">الكل</option>
            {(clientsRes.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          الحالة
          <select name="status" defaultValue={status} className={FIELD}>
            <option value="">الكل</option>
            {Object.entries(INVOICE_STATUS).map(([value, s]) => (
              <option key={value} value={value}>
                {s.label}
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

      <div className="flex flex-col gap-5">
        <StatGrid>
          <Stat label="الفواتير الصادرة" value={formatMoney(sumMinor(issued.map((r) => r.total_minor)), "JOD", { fractionDigits: 0 })} hint={`${formatInt(issued.length)} فاتورة`} />
          <Stat label="منها ضريبة المبيعات" value={formatMoney(sumMinor(issued.map((r) => r.vat_minor)), "JOD", { fractionDigits: 0 })} />
          <Stat
            label="نقلات غير مفوترة"
            value={formatInt(unbilledLoads)}
            hint={formatMoney(unbilledMinor, "JOD", { fractionDigits: 0 })}
            tone={unbilledLoads ? "warning" : "neutral"}
          />
          <Stat label="ملغاة" value={formatInt(rows.length - issued.length)} />
        </StatGrid>

        <Card>
          <CardHeader
            title="سجل الفواتير"
            subtitle={unsent ? `${formatInt(unsent)} فاتورة أو إرجاع لم يُقبل بعد في جوفوترة` : undefined}
            action={<ExportButton tableId="invoices-table" file="invoices" title={`الفواتير من ${formatDate(f.from)} إلى ${formatDate(f.to)}`} />} />
          {rows.length === 0 ? (
            <EmptyState>لا توجد فواتير في هذه الفترة.</EmptyState>
          ) : (
            <Table id="invoices-table">
              <thead>
                <tr>
                  <Th>رقم الفاتورة</Th>
                  <Th>التاريخ</Th>
                  <Th>الزبون</Th>
                  <Th>الفترة</Th>
                  <Th className="text-end">النقلات</Th>
                  <Th className="text-end">قبل الضريبة</Th>
                  <Th className="text-end">الضريبة</Th>
                  <Th className="text-end">الإجمالي</Th>
                  <Th>الاستحقاق</Th>
                  <Th>الحالة</Th>
                  <Th>جوفوترة</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = INVOICE_STATUS[r.status];
                  return (
                    <Tr key={r.id} className={r.status === "cancelled" ? "text-muted" : ""}>
                      <Td className="num">
                        <Link href={`/invoices/${r.id}`} className="font-semibold text-primary hover:underline">
                          {r.invoice_no}
                        </Link>
                      </Td>
                      <Td className="num whitespace-nowrap">{formatDate(r.invoice_date)}</Td>
                      <Td className="whitespace-nowrap">{(r.client as { name: string } | null)?.name}</Td>
                      <Td className="num whitespace-nowrap text-xs">
                        {formatDate(r.period_from)} – {formatDate(r.period_to)}
                      </Td>
                      <Td className="num text-end">{r.lines_count}</Td>
                      <Td className="num whitespace-nowrap text-end">{formatMoney(r.subtotal_minor, "JOD", { withCurrency: false })}</Td>
                      <Td className="num whitespace-nowrap text-end">{formatMoney(r.vat_minor, "JOD", { withCurrency: false })}</Td>
                      <Td className="num whitespace-nowrap text-end font-semibold">{formatMoney(r.total_minor, "JOD", { withCurrency: false })}</Td>
                      <Td className="num whitespace-nowrap">{formatDate(r.due_date)}</Td>
                      <Td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </Td>
                      <Td>
                        {(() => {
                          const e = einvoice(r);
                          return e ? <Badge tone={e.tone}>{e.label}</Badge> : <span className="text-muted">—</span>;
                        })()}
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
