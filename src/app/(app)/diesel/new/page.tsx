import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { FUEL_WRITERS } from "@/lib/roles";
import { todayIso } from "@/lib/date-range";
import { nowTime } from "@/lib/fuel";
import { loadOfficeOptions } from "@/lib/office-options";
import { saveOfficeFillup } from "../actions";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { OfficeFillupForm } from "@/components/office-fillup-form";

export const metadata: Metadata = { title: "تعبئة ديزل" };

export default async function NewFillupPage({ searchParams }: { searchParams: Promise<{ truck?: string }> }) {
  const profile = await requireRole(...FUEL_WRITERS);
  const { truck } = await searchParams;
  const options = await loadOfficeOptions();
  const t = options.trucks.find((x) => x.id === truck);

  return (
    <>
      <Link href="/diesel" className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        الديزل
      </Link>
      <PageHeader title="تعبئة ديزل" subtitle="الحقول المعلّمة بـ * مطلوبة" />
      <Card>
        <CardBody>
          <OfficeFillupForm
            options={options}
            today={todayIso()}
            time={nowTime()}
            initial={t ? { truck_id: t.id, driver_id: t.driverId } : {}}
            action={saveOfficeFillup.bind(null, null)}
            submitLabel="حفظ التعبئة"
            note={profile.role === "dispatcher" ? "تُرسل التعبئة للمحاسب للموافقة قبل احتسابها." : undefined}
          />
        </CardBody>
      </Card>
    </>
  );
}
