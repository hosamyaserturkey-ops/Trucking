import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { formatMoney } from "@/lib/money";
import { EXPENSE_STATUS } from "@/lib/labels";
import { loadOfficeOptions } from "@/lib/office-options";
import { deleteOfficeExpense, saveOfficeExpense } from "../../actions";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, EmptyState, PageHeader } from "@/components/ui/card";
import { OfficeExpenseForm } from "@/components/office-expense-form";
import { WithdrawExpenseButton } from "@/components/driver-trip-card";
import { JournalEntryCard } from "@/components/journal-entry-card";

export const metadata: Metadata = { title: "تعديل مصروف" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditOfficeExpensePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(...FINANCE_ROLES);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const { data: e } = await supabase
    .from("expenses")
    .select(
      "id, cost_scope, truck_id, trip_id, driver_id, category_id, supplier_id, description, expense_date, currency, fx_rate, amount_minor, payment_method, reference_no, voucher_no, customs_declaration_no, notice_no, notes, receipt_path, status, settlement_id, reviewed_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!e) notFound();
  const st = EXPENSE_STATUS[e.status];

  let blocked: React.ReactNode = null;
  if (e.settlement_id) blocked = "هذا المصروف داخل في تسوية عهدة ولا يمكن تعديله.";
  else if (e.status === "rejected") blocked = "هذا المصروف مرفوض ولا يُعدّل؛ سجّل مصروفاً جديداً إذا لزم.";
  else if (e.status === "submitted")
    blocked = (
      <>
        هذا المصروف أرسله سائق وينتظر الموافقة.{" "}
        <LinkButton href="/approvals" variant="secondary" className="ms-2">
          الموافقات
        </LinkButton>
      </>
    );

  return (
    <>
      <Link href="/expenses" className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        المصاريف
      </Link>
      <PageHeader title="تعديل مصروف" subtitle={<Badge tone={st.tone}>{st.label}</Badge>} />
      <Card>
        {blocked ? (
          <EmptyState>{blocked}</EmptyState>
        ) : (
          <CardBody className="flex flex-col gap-6">
            <OfficeExpenseForm
              recordId={e.id}
              options={await loadOfficeOptions()}
              today={todayIso()}
              initial={{
                cost_scope: e.cost_scope,
                truck_id: e.truck_id,
                trip_id: e.trip_id,
                driver_id: e.driver_id,
                category_id: e.category_id,
                supplier_id: e.supplier_id,
                description: e.description,
                expense_date: e.expense_date,
                currency: e.currency,
                fx_rate: String(e.fx_rate),
                amount: formatMoney(e.amount_minor, e.currency, { withCurrency: false }),
                payment_method: e.payment_method,
                reference_no: e.reference_no,
                voucher_no: e.voucher_no,
                customs_declaration_no: e.customs_declaration_no,
                notice_no: e.notice_no,
                notes: e.notes,
                hasReceipt: Boolean(e.receipt_path),
              }}
              action={saveOfficeExpense.bind(null, e.id)}
              submitLabel="حفظ التعديلات"
            />
            {/* A reviewed expense (sent by a driver) stays, with its receipt. */}
            {e.reviewed_at ? null : (
              <div className="border-t border-border pt-4">
                <WithdrawExpenseButton action={deleteOfficeExpense.bind(null, e.id)} />
              </div>
            )}
          </CardBody>
        )}
      </Card>
      <div className="mt-5">
        <JournalEntryCard sourceType="expense" sourceId={e.id} />
      </div>
    </>
  );
}
