import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { loadDriverFuelOptions } from "@/lib/driver-data";
import { loadLastFuelPrices } from "@/lib/fuel-prices";
import { formatQuantity, FUEL_UNITS, isFuelUnit, nowTime } from "@/lib/fuel";
import { formatMoney } from "@/lib/money";
import { formatDateTime, formatInt } from "@/lib/format";
import { EXPENSE_STATUS } from "@/lib/labels";
import { saveDriverFillup } from "../../actions";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { DriverFuelForm } from "@/components/driver-fuel-form";

export const metadata: Metadata = { title: "تعبئة ديزل" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DriverFillupPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("driver");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const { data: fill } = await supabase
    .from("fuel_fillups")
    .select("id, trip_id, station_id, filled_at, odometer, qty_unit, quantity, unit_price_minor, is_full_tank, currency, amount_minor, notes, receipt_path, status, rejection_reason")
    .eq("id", id)
    .maybeSingle();
  if (!fill) notFound();

  const back = (
    <LinkButton href="/my" variant="ghost">
      <ChevronRight className="size-4" aria-hidden />
      رجوع
    </LinkButton>
  );

  if (fill.status !== "submitted") {
    const st = EXPENSE_STATUS[fill.status];
    return (
      <>
        <PageHeader title="تعبئة ديزل" action={back} />
        <Card className="max-w-lg">
          <CardBody className="flex flex-col gap-2 text-sm">
            <p>
              <Badge tone={st.tone}>{st.label}</Badge>
            </p>
            <p className="num text-lg font-bold">{formatMoney(fill.amount_minor, fill.currency)}</p>
            <p>
              <span className="num">{formatQuantity(fill.quantity, fill.qty_unit)}</span> ·{" "}
              {isFuelUnit(fill.qty_unit) ? FUEL_UNITS[fill.qty_unit].price : "السعر"}{" "}
              <span className="num">{formatMoney(fill.unit_price_minor, fill.currency)}</span>
            </p>
            <p>
              العداد <span className="num">{formatInt(fill.odometer)}</span> · <span className="num">{formatDateTime(fill.filled_at)}</span>
            </p>
            {fill.rejection_reason ? <p className="text-danger">سبب الرفض: {fill.rejection_reason}</p> : null}
            <p className="text-muted">تمت مراجعة هذه التعبئة ولا يمكن تعديلها. لتصحيحها سجّل تعبئة جديدة.</p>
          </CardBody>
        </Card>
      </>
    );
  }

  const at = new Date(fill.filled_at);
  const [{ trips, stations, truck }, lastPrices] = await Promise.all([loadDriverFuelOptions(), loadLastFuelPrices()]);
  return (
    <>
      <PageHeader title="تعديل تعبئة ديزل" subtitle="يمكن التعديل حتى تتم المراجعة" action={back} />
      <Card className="max-w-lg">
        <CardBody>
          <DriverFuelForm
            recordId={fill.id}
            trips={trips}
            stations={stations}
            lastPrices={lastPrices}
            truckLabel={truck?.code ?? null}
            lastOdometer={truck?.lastOdometer ?? null}
            today={todayIso()}
            time={nowTime()}
            initial={{
              trip_id: fill.trip_id ?? "",
              station_id: fill.station_id,
              filled_on: todayIso(at),
              filled_time: nowTime(at),
              odometer: String(fill.odometer),
              qty_unit: fill.qty_unit,
              quantity: String(fill.quantity),
              unit_price: formatMoney(fill.unit_price_minor, fill.currency, { withCurrency: false }),
              is_full_tank: fill.is_full_tank,
              currency: fill.currency,
              notes: fill.notes,
              hasReceipt: Boolean(fill.receipt_path),
            }}
            action={saveDriverFillup.bind(null, fill.id)}
            submitLabel="حفظ التعديل"
          />
        </CardBody>
      </Card>
    </>
  );
}
