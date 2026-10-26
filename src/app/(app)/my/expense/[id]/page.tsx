import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { loadDriverExpenseOptions } from "@/lib/driver-data";
import { formatMoney } from "@/lib/money";
import { EXPENSE_STATUS } from "@/lib/labels";
import { saveDriverExpense } from "../../actions";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { DriverExpenseForm } from "@/components/driver-expense-form";

export const metadata: Metadata = { title: "تعديل مصروف" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditDriverExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("driver");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const { data: expense } = await supabase
    .from("expenses")
    .select("id, trip_id, category_id, expense_date, currency, amount_minor, payment_method, description, receipt_path, status, rejection_reason")
    .eq("id", id)
    .maybeSingle();
  if (!expense) notFound();

  const back = (
    <LinkButton href="/my" variant="ghost">
      <ChevronRight className="size-4" aria-hidden />
      رجوع
    </LinkButton>
  );

  if (expense.status !== "submitted") {
    const st = EXPENSE_STATUS[expense.status];
    return (
      <>
        <PageHeader title="مصروف" action={back} />
        <Card className="max-w-lg">
          <CardBody className="flex flex-col gap-2 text-sm">
            <p>
              <Badge tone={st.tone}>{st.label}</Badge>
            </p>
            <p className="num text-lg font-bold">{formatMoney(expense.amount_minor, expense.currency)}</p>
            <p>{expense.description}</p>
            {expense.rejection_reason ? <p className="text-danger">سبب الرفض: {expense.rejection_reason}</p> : null}
            <p className="text-muted">تمت مراجعة هذا المصروف ولا يمكن تعديله. لتصحيحه سجّل مصروفاً جديداً.</p>
          </CardBody>
        </Card>
      </>
    );
  }

  const { trips, categories } = await loadDriverExpenseOptions();
  return (
    <>
      <PageHeader title="تعديل مصروف" subtitle="يمكن التعديل حتى تتم المراجعة" action={back} />
      <Card className="max-w-lg">
        <CardBody>
          <DriverExpenseForm
            userId={profile.user_id}
            trips={trips}
            categories={categories}
            today={todayIso()}
            initial={{
              trip_id: expense.trip_id,
              category_id: expense.category_id,
              expense_date: expense.expense_date,
              currency: expense.currency,
              amount: formatMoney(expense.amount_minor, expense.currency, { withCurrency: false }),
              payment_method: expense.payment_method ?? undefined,
              description: expense.description,
              hasReceipt: Boolean(expense.receipt_path),
            }}
            action={saveDriverExpense.bind(null, expense.id)}
            submitLabel="حفظ التعديل"
          />
        </CardBody>
      </Card>
    </>
  );
}
