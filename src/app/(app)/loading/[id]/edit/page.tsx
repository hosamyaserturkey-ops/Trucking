import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { TRIP_WRITERS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { loadTripOptions } from "@/lib/trip-options";
import { formatMoney } from "@/lib/money";
import { saveLoad } from "../../actions";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { LoadForm } from "@/components/load-form";

export const metadata: Metadata = { title: "تعديل نقلة" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditLoadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(...TRIP_WRITERS);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: load }, options] = await Promise.all([
    supabase
      .from("trips")
      .select("id, client_ref, start_date, truck_id, driver_id, client_id, from_location_id, to_location_id, cargo_description, cargo_weight_tons, currency, freight_minor, fx_rate, client_doc_no, notes")
      .eq("id", id)
      .eq("entry_source", "sheet")
      .maybeSingle(),
    loadTripOptions(),
  ]);
  if (!load) notFound();

  return (
    <>
      <PageHeader
        title={`تعديل النقلة ${load.client_ref ?? ""}`}
        subtitle="رقم الإشارة يبقى كما هو، إلا إذا تغيّر الزبون فيأخذ رقماً من تسلسل الزبون الجديد"
        action={
          <LinkButton href={`/loading?date=${load.start_date}`} variant="secondary">
            رجوع للكشف
          </LinkButton>
        }
      />
      <Card>
        <CardBody>
          <LoadForm
            options={options}
            today={todayIso()}
            initial={{
              load_date: load.start_date,
              truck_id: load.truck_id,
              driver_id: load.driver_id,
              client_id: load.client_id ?? undefined,
              from_location_id: load.from_location_id ?? undefined,
              to_location_id: load.to_location_id ?? undefined,
              cargo_description: load.cargo_description,
              cargo_weight_tons: load.cargo_weight_tons,
              currency: load.currency,
              freight: formatMoney(load.freight_minor, load.currency, { withCurrency: false }).replace(/,/g, ""),
              fx_rate: load.fx_rate,
              client_doc_no: load.client_doc_no,
              notes: load.notes,
            }}
            action={saveLoad.bind(null, load.id)}
            submitLabel="حفظ التعديلات"
          />
        </CardBody>
      </Card>
    </>
  );
}
