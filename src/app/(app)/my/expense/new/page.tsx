import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { todayIso } from "@/lib/date-range";
import { loadDriverExpenseOptions } from "@/lib/driver-data";
import { saveDriverExpense } from "../../actions";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, EmptyState, PageHeader } from "@/components/ui/card";
import { DriverExpenseForm } from "@/components/driver-expense-form";

export const metadata: Metadata = { title: "مصروف جديد" };

export default async function NewDriverExpensePage({ searchParams }: { searchParams: Promise<{ trip?: string }> }) {
  const profile = await requireRole("driver");
  const { trip } = await searchParams;
  const { trips, categories } = await loadDriverExpenseOptions();

  return (
    <>
      <PageHeader
        title="مصروف جديد"
        subtitle="يُرسل للمحاسب للموافقة قبل احتسابه"
        action={
          <LinkButton href="/my" variant="ghost">
            <ChevronRight className="size-4" aria-hidden />
            رجوع
          </LinkButton>
        }
      />
      <Card className="max-w-lg">
        {trips.length === 0 ? (
          <EmptyState>لا توجد رحلات مسجلة لك بعد، لذلك لا يمكن تسجيل مصروف.</EmptyState>
        ) : (
          <CardBody>
            <DriverExpenseForm
              userId={profile.user_id}
              trips={trips}
              categories={categories}
              today={todayIso()}
              initial={{ trip_id: trips.some((t) => t.id === trip) ? trip : undefined }}
              action={saveDriverExpense.bind(null, null)}
              submitLabel="إرسال للموافقة"
            />
          </CardBody>
        )}
      </Card>
    </>
  );
}
