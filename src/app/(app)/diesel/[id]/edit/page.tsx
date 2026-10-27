import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES, FUEL_WRITERS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { nowTime } from "@/lib/fuel";
import { formatMoney } from "@/lib/money";
import { EXPENSE_STATUS } from "@/lib/labels";
import { loadOfficeOptions } from "@/lib/office-options";
import { loadLastFuelPrices } from "@/lib/fuel-prices";
import { deleteOfficeFillup, saveOfficeFillup } from "../../actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, EmptyState, PageHeader } from "@/components/ui/card";
import { OfficeFillupForm } from "@/components/office-fillup-form";
import { WithdrawExpenseButton } from "@/components/driver-trip-card";

export const metadata: Metadata = { title: "تعديل تعبئة" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditFillupPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole(...FUEL_WRITERS);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const { data: f } = await supabase
    .from("fuel_fillups")
    .select("id, truck_id, driver_id, trip_id, station_id, filled_at, odometer, qty_unit, quantity, unit_price_minor, is_full_tank, currency, fx_rate, payment_method, notes, receipt_path, status, settlement_id, reviewed_at")
    .eq("id", id)
    .maybeSingle();
  if (!f) notFound();

  // Settled rows are frozen; a dispatcher may only fix entries that still wait for approval.
  const finance = FINANCE_ROLES.includes(profile.role);
  const editable = !f.settlement_id && (finance || f.status === "submitted");
  const st = EXPENSE_STATUS[f.status];
  const at = new Date(f.filled_at);

  return (
    <>
      <Link href="/diesel" className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        الديزل
      </Link>
      <PageHeader title="تعديل تعبئة" subtitle={<Badge tone={st.tone}>{st.label}</Badge>} />
      <Card>
        {editable ? (
          <CardBody className="flex flex-col gap-6">
            <OfficeFillupForm
              recordId={f.id}
              options={await loadOfficeOptions()}
              lastPrices={await loadLastFuelPrices()}
              today={todayIso()}
              time={nowTime()}
              initial={{
                truck_id: f.truck_id,
                driver_id: f.driver_id,
                trip_id: f.trip_id,
                station_id: f.station_id,
                filled_on: todayIso(at),
                filled_time: nowTime(at),
                odometer: String(f.odometer),
                qty_unit: f.qty_unit,
                quantity: String(f.quantity),
                unit_price: formatMoney(f.unit_price_minor, f.currency, { withCurrency: false }),
                is_full_tank: f.is_full_tank,
                currency: f.currency,
                fx_rate: String(f.fx_rate),
                payment_method: f.payment_method,
                notes: f.notes,
                hasReceipt: Boolean(f.receipt_path),
              }}
              action={saveOfficeFillup.bind(null, f.id)}
              submitLabel="حفظ التعديلات"
            />
            {/* A reviewed fill-up stays, with its receipt. */}
            {f.reviewed_at ? null : (
              <div className="border-t border-border pt-4">
                <WithdrawExpenseButton action={deleteOfficeFillup.bind(null, f.id)} />
              </div>
            )}
          </CardBody>
        ) : (
          <EmptyState>
            {f.settlement_id ? "هذه التعبئة داخلة في تسوية عهدة ولا يمكن تعديلها." : "تعديل التعبئات المعتمدة للمدير والمحاسب فقط."}
          </EmptyState>
        )}
      </Card>
    </>
  );
}
