import { requireRole } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { truckPage, type TruckPageProps } from "@/lib/truck";
import { formatMoney, sumMinor } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { PAYMENT_METHOD } from "@/lib/labels";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";

export default async function TruckExpensesPage(props: TruckPageProps) {
  await requireRole(...STAFF_ROLES);
  const { id, range } = await truckPage(props);
  const supabase = await createClient();

  const [expensesRes, overheadRes] = await Promise.all([
    supabase
      .from("expenses")
      .select(
        "id, expense_date, description, currency, amount_minor, amount_base_minor, payment_method, reference_no, category:expense_categories(name_ar), trip:trips(trip_no), driver:drivers(full_name)",
      )
      .eq("truck_id", id)
      .gte("expense_date", range.from)
      .lt("expense_date", range.to)
      .order("expense_date", { ascending: false }),
    supabase
      .from("truck_pnl_facts_v")
      .select("fact_date, category_name, amount_base_minor, source_id")
      .eq("truck_id", id)
      .eq("kind", "overhead")
      .gte("fact_date", range.from)
      .lt("fact_date", range.to)
      .order("fact_date", { ascending: false }),
  ]);

  const expenses = expensesRes.data ?? [];
  const overhead = overheadRes.data ?? [];

  const byCategory = new Map<string, number>();
  for (const e of expenses) {
    const name = (e.category as { name_ar: string } | null)?.name_ar ?? "أخرى";
    byCategory.set(name, (byCategory.get(name) ?? 0) + e.amount_base_minor);
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const direct = sumMinor(expenses.map((e) => e.amount_base_minor));
  const allocated = sumMinor(overhead.map((o) => o.amount_base_minor));

  return (
    <>
      <Card>
        <CardHeader title="المصاريف حسب الفئة" subtitle={range.label} />
        {categories.length === 0 && overhead.length === 0 ? (
          <EmptyState>لا توجد مصاريف في هذه الفترة.</EmptyState>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {categories.map(([name, value]) => (
              <li key={name} className="flex items-center justify-between px-4 py-2.5">
                <span>{name}</span>
                <span className="num">{formatMoney(value)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between px-4 py-2.5 font-semibold">
              <span>مصاريف مباشرة على الشاحنة</span>
              <span className="num">{formatMoney(direct)}</span>
            </li>
            <li className="flex items-center justify-between px-4 py-2.5">
              <span>
                حصة الشاحنة من المصاريف العامة
                <span className="block text-xs text-muted">إيجار ورواتب إدارية وغيرها، موزعة حسب قاعدة التوزيع</span>
              </span>
              <span className="num">{formatMoney(allocated)}</span>
            </li>
            <li className="flex items-center justify-between bg-surface-2 px-4 py-2.5 font-bold">
              <span>المجموع</span>
              <span className="num">{formatMoney(direct + allocated)}</span>
            </li>
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="تفاصيل المصاريف المباشرة" subtitle="رسوم الطرق والمخالفات ومكافآت السائقين والتأمين والإطارات" />
        {expenses.length === 0 ? (
          <EmptyState>لا توجد مصاريف مباشرة في هذه الفترة.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>التاريخ</Th>
                <Th>الفئة</Th>
                <Th>البيان</Th>
                <Th>الرحلة</Th>
                <Th>السائق</Th>
                <Th>الدفع</Th>
                <Th className="text-end">المبلغ</Th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <Tr key={e.id}>
                  <Td className="num whitespace-nowrap">{formatDate(e.expense_date)}</Td>
                  <Td className="whitespace-nowrap">{(e.category as { name_ar: string } | null)?.name_ar}</Td>
                  <Td>{e.description}</Td>
                  <Td className="num">{(e.trip as { trip_no: number } | null)?.trip_no ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{(e.driver as { full_name: string } | null)?.full_name ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{PAYMENT_METHOD[e.payment_method] ?? e.payment_method}</Td>
                  <Td className="num whitespace-nowrap text-end">
                    {formatMoney(e.amount_minor, e.currency)}
                    {e.currency !== "JOD" ? (
                      <span className="block text-xs text-muted">{formatMoney(e.amount_base_minor)}</span>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
