import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { todayIso } from "@/lib/date-range";
import { loadOfficeOptions } from "@/lib/office-options";
import { saveOfficeExpense } from "../actions";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { OfficeExpenseForm } from "@/components/office-expense-form";

export const metadata: Metadata = { title: "مصروف جديد" };

export default async function NewOfficeExpensePage({ searchParams }: { searchParams: Promise<{ truck?: string }> }) {
  await requireRole(...FINANCE_ROLES);
  const { truck } = await searchParams;
  const options = await loadOfficeOptions();
  const t = options.trucks.find((x) => x.id === truck);

  return (
    <>
      <Link href="/expenses" className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        المصاريف
      </Link>
      <PageHeader title="مصروف جديد" subtitle="يُحتسب فوراً؛ مصاريف السائقين تأتي من شاشة الموافقات" />
      <Card>
        <CardBody>
          <OfficeExpenseForm
            options={options}
            today={todayIso()}
            initial={t ? { truck_id: t.id, driver_id: t.driverId } : {}}
            action={saveOfficeExpense.bind(null, null)}
            submitLabel="حفظ المصروف"
          />
        </CardBody>
      </Card>
    </>
  );
}
