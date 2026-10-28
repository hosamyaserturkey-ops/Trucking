import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { draftPeriod } from "@/lib/invoicing";
import { formatMoney } from "@/lib/money";
import { formatDate, formatInt } from "@/lib/format";
import { issueInvoice } from "../actions";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { InvoiceDraftForm, type DraftLoad } from "@/components/invoice-forms";

export const metadata: Metadata = { title: "فاتورة جديدة" };

type SearchParams = Promise<{ client?: string; from?: string; to?: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD = "rounded-lg border border-border bg-surface px-3 py-2 text-sm";

/** Pick a customer and a period, then tick the finished loads not invoiced yet. */
export default async function NewInvoicePage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(...FINANCE_ROLES);
  const sp = await searchParams;
  const clientId = sp.client && UUID.test(sp.client) ? sp.client : "";
  const supabase = await createClient();
  let period = draftPeriod(sp);
  if (clientId && !(sp.from && sp.to)) {
    // A customer picked without a period: from his oldest load not invoiced yet, to today.
    const { data: oldest } = await supabase
      .from("trips")
      .select("start_date")
      .eq("client_id", clientId)
      .eq("status", "completed")
      .eq("is_empty_return", false)
      .is("invoice_id", null)
      .gt("freight_base_minor", 0)
      .order("start_date")
      .limit(1)
      .maybeSingle();
    if (oldest) period = { from: oldest.start_date, to: todayIso() };
  }

  const [clientsRes, settingsRes, balanceRes] = await Promise.all([
    supabase.from("clients").select("id, name, vat_exempt, payment_terms_days, ref_code").eq("is_active", true).order("name"),
    supabase.from("company_settings").select("vat_rate_pct").maybeSingle(),
    supabase.from("client_balance_v").select("client_id, unbilled_loads, unbilled_minor").gt("unbilled_loads", 0),
  ]);
  const clients = clientsRes.data ?? [];
  const unbilled = new Map((balanceRes.data ?? []).map((b) => [b.client_id, b]));
  const client = clients.find((c) => c.id === clientId);
  const vatRate = client?.vat_exempt ? 0 : Number(settingsRes.data?.vat_rate_pct ?? 16);

  let loads: DraftLoad[] = [];
  let outside = 0;
  if (client) {
    const { data } = await supabase
      .from("trips")
      .select(
        "id, start_date, client_ref, client_doc_no, cargo_description, cargo_weight_tons, currency, freight_minor, freight_base_minor, truck:trucks(code), from_loc:locations!trips_from_location_id_fkey(name), to_loc:locations!trips_to_location_id_fkey(name)",
      )
      .eq("client_id", client.id)
      .eq("status", "completed")
      .eq("is_empty_return", false)
      .is("invoice_id", null)
      .gt("freight_base_minor", 0)
      .gte("start_date", period.from)
      .lte("start_date", period.to)
      .order("start_date")
      .order("trip_no")
      .limit(500);
    loads = (data ?? []).map((x) => ({
      id: x.id,
      date: x.start_date,
      ref: x.client_ref,
      docNo: x.client_doc_no,
      truck: (x.truck as { code: string } | null)?.code ?? "",
      route: [(x.from_loc as { name: string } | null)?.name, (x.to_loc as { name: string } | null)?.name].filter(Boolean).join(" ← "),
      cargo: x.cargo_description,
      tons: x.cargo_weight_tons,
      amountMinor: x.freight_base_minor,
      original: x.currency !== "JOD" ? formatMoney(x.freight_minor, x.currency) : null,
    }));
    outside = Math.max(0, (unbilled.get(client.id)?.unbilled_loads ?? 0) - loads.length);
  }

  return (
    <>
      <Link href="/invoices" className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        الفواتير
      </Link>
      <PageHeader title="فاتورة جديدة" subtitle="زبون وفترة، ثم اختر النقلات المنتهية غير المفوترة" />

      <form action="/invoices/new" className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1 text-xs text-muted">
          الزبون
          <select name="client" defaultValue={clientId} className={FIELD} required>
            <option value="">اختر الزبون</option>
            {clients.map((c) => {
              const u = unbilled.get(c.id);
              return (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {u ? ` (${u.unbilled_loads} غير مفوترة)` : ""}
                </option>
              );
            })}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          من
          <input type="date" name="from" defaultValue={period.from} className={FIELD} dir="ltr" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          إلى
          <input type="date" name="to" defaultValue={period.to} className={FIELD} dir="ltr" />
        </label>
        <button type="submit" className={buttonClass("secondary")}>
          عرض النقلات
        </button>
      </form>

      {client ? (
        <Card>
          <CardHeader
            title={`نقلات ${client.name} غير المفوترة`}
            subtitle={`من ${formatDate(period.from)} إلى ${formatDate(period.to)} · ${
              client.vat_exempt ? "معفى من الضريبة" : `ضريبة المبيعات ${vatRate}%`
            } · مدة السداد ${formatInt(client.payment_terms_days)} يوم`}
          />
          {outside > 0 ? (
            <p className="mx-4 mt-3 text-sm text-muted">
              يوجد {formatInt(outside)} نقلة أخرى غير مفوترة لهذا الزبون خارج هذه الفترة.
            </p>
          ) : null}
          {loads.length === 0 ? (
            <EmptyState>لا توجد نقلات منتهية غير مفوترة لهذا الزبون في هذه الفترة.</EmptyState>
          ) : (
            <CardBody>
              <InvoiceDraftForm action={issueInvoice} clientId={client.id} loads={loads} vatRatePct={vatRate} today={todayIso()} />
            </CardBody>
          )}
        </Card>
      ) : (
        <Card>
          <EmptyState>اختر الزبون والفترة لعرض نقلاته.</EmptyState>
        </Card>
      )}
    </>
  );
}
