import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { todayIso } from "@/lib/date-range";
import { loadDriverFuelOptions } from "@/lib/driver-data";
import { nowTime } from "@/lib/fuel";
import { saveDriverFillup } from "../../actions";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { DriverFuelForm } from "@/components/driver-fuel-form";

export const metadata: Metadata = { title: "تعبئة ديزل" };

export default async function NewDriverFillupPage({ searchParams }: { searchParams: Promise<{ trip?: string }> }) {
  await requireRole("driver");
  const { trip } = await searchParams;
  const { trips, stations, truck } = await loadDriverFuelOptions();

  return (
    <>
      <PageHeader
        title="تعبئة ديزل"
        subtitle="دفعتها من العهدة؛ تُرسل للمحاسب للموافقة"
        action={
          <LinkButton href="/my" variant="ghost">
            <ChevronRight className="size-4" aria-hidden />
            رجوع
          </LinkButton>
        }
      />
      <Card className="max-w-lg">
        <CardBody>
          <DriverFuelForm
            trips={trips}
            stations={stations}
            truckLabel={truck?.code ?? null}
            lastOdometer={truck?.lastOdometer ?? null}
            today={todayIso()}
            time={nowTime()}
            initial={{ trip_id: trips.some((t) => t.id === trip) ? trip : undefined }}
            action={saveDriverFillup.bind(null, null)}
            submitLabel="إرسال للموافقة"
          />
        </CardBody>
      </Card>
    </>
  );
}
