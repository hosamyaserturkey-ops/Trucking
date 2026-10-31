import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { todayIso } from "@/lib/date-range";
import { loadMaintenanceOptions } from "@/lib/maintenance-options";
import { WORK_ORDER_KIND } from "@/lib/labels";
import { createWorkOrder } from "../actions";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { WorkOrderForm } from "@/components/work-order-forms";

export const metadata: Metadata = { title: "أمر صيانة جديد" };

type SearchParams = Promise<{ truck?: string; kind?: string; service?: string }>;

export default async function NewWorkOrderPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(...STAFF_ROLES);
  const sp = await searchParams;
  const options = await loadMaintenanceOptions();
  const truck = options.trucks.find((t) => t.id === sp.truck);
  const kind = sp.kind && WORK_ORDER_KIND[sp.kind] ? sp.kind : "repair";
  const service = (sp.service ?? "").slice(0, 80);

  return (
    <>
      <Link href="/maintenance" className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        الصيانة
      </Link>
      <PageHeader title="أمر صيانة جديد" subtitle="افتح الأمر عند دخول الشاحنة للورشة، ثم أضف القطع والأجور في صفحته" />
      <Card>
        <CardBody>
          <WorkOrderForm
            action={createWorkOrder}
            trucks={options.trucks}
            workshops={options.workshops}
            today={todayIso()}
            initial={{
              truck_id: truck?.id,
              kind,
              odometer: truck?.odometer ?? null,
              description: service ? `صيانة دورية: ${service}` : "",
            }}
            submitLabel="فتح أمر الصيانة"
          />
        </CardBody>
      </Card>
    </>
  );
}
