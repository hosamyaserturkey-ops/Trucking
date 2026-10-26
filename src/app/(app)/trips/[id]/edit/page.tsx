import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { TRIP_WRITERS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/money";
import { loadTripOptions } from "@/lib/trip-options";
import { saveTrip } from "../../actions";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { TripForm } from "@/components/trip-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditTripPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(...TRIP_WRITERS);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: trip }, options] = await Promise.all([
    supabase.from("trips").select("*").eq("id", id).maybeSingle(),
    loadTripOptions(),
  ]);
  if (!trip) notFound();

  return (
    <>
      <Link href={`/trips/${id}`} className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        الرحلة <span className="num">{trip.trip_no}</span>
      </Link>
      <PageHeader title={<>تعديل الرحلة <span className="num">{trip.trip_no}</span></>} />
      <Card>
        <CardBody>
          <TripForm
            options={options}
            mode="edit"
            action={saveTrip.bind(null, id)}
            initial={{
              truck_id: trip.truck_id,
              driver_id: trip.driver_id,
              client_id: trip.client_id,
              from_location_id: trip.from_location_id ?? undefined,
              to_location_id: trip.to_location_id ?? undefined,
              start_date: trip.start_date,
              start_odometer: trip.start_odometer,
              cargo_description: trip.cargo_description,
              cargo_weight_tons: trip.cargo_weight_tons,
              is_empty_return: trip.is_empty_return,
              currency: trip.currency,
              freight: trip.freight_minor ? formatMoney(trip.freight_minor, trip.currency, { withCurrency: false }).replace(/,/g, "") : "",
              fx_rate: trip.fx_rate,
              notes: trip.notes,
            }}
          />
        </CardBody>
      </Card>
    </>
  );
}
