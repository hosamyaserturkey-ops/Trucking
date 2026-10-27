import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { TRIP_WRITERS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { loadTripOptions } from "@/lib/trip-options";
import { saveTrip } from "../actions";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { TripForm, type TripInitial } from "@/components/trip-form";

export const metadata: Metadata = { title: "رحلة جديدة" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewTripPage({
  searchParams,
}: {
  searchParams: Promise<{ return_of?: string; truck?: string }>;
}) {
  await requireRole(...TRIP_WRITERS);
  const sp = await searchParams;
  const options = await loadTripOptions();
  const today = todayIso();

  let initial: TripInitial = { start_date: today };
  let title = "رحلة جديدة";

  // Return leg: same truck and driver, route reversed, starting where the outbound ended.
  if (sp.return_of && UUID.test(sp.return_of)) {
    const supabase = await createClient();
    const { data: src } = await supabase
      .from("trips")
      .select("trip_no, truck_id, driver_id, from_location_id, to_location_id, end_date, end_odometer, start_odometer")
      .eq("id", sp.return_of)
      .maybeSingle();
    if (src) {
      title = `رحلة العودة للرحلة ${src.trip_no}`;
      initial = {
        truck_id: src.truck_id,
        driver_id: src.driver_id,
        from_location_id: src.to_location_id ?? undefined,
        to_location_id: src.from_location_id ?? undefined,
        start_date: src.end_date ?? today,
        start_odometer: src.end_odometer ?? src.start_odometer,
        notes: `عودة من الرحلة ${src.trip_no}`,
      };
    }
  } else if (sp.truck && UUID.test(sp.truck)) {
    const t = options.trucks.find((x) => x.id === sp.truck);
    if (t) initial = { start_date: today, truck_id: t.id, driver_id: t.driverId, start_odometer: t.odometer };
  }

  return (
    <>
      <Link href="/trips" className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        الرحلات
      </Link>
      <PageHeader title={title} subtitle="الحقول المعلّمة بـ * مطلوبة" />
      <Card>
        <CardBody>
          <TripForm options={options} initial={initial} action={saveTrip.bind(null, null)} mode="new" />
        </CardBody>
      </Card>
    </>
  );
}
