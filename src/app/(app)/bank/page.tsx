import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { formatMoney } from "@/lib/money";
import { formatDate, formatInt } from "@/lib/format";
import { createBankStatement } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { BankStatementImport, type PreviousStatement } from "@/components/bank-forms";

export const metadata: Metadata = { title: "مطابقة البنك" };

/** Bank statements and their reconciliation status, and the form to enter a new one. */
export default async function BankPage() {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const [statementsRes, accountsRes] = await Promise.all([
    supabase
      .from("bank_statements")
      .select("id, statement_no, account_id, period_from, period_to, opening_balance_minor, closing_balance_minor, lines_count, source_name, status, account:accounts(code, name_ar)")
      .order("period_to", { ascending: false })
      .limit(200),
    supabase.from("accounts").select("id, code, name_ar, type, is_postable, is_active").like("code", "1102%").eq("type", "asset").eq("is_postable", true).order("code"),
  ]);
  const statements = statementsRes.data ?? [];
  const accounts = (accountsRes.data ?? []).filter((a) => a.is_active).map((a) => ({ id: a.id, label: `${a.code} ${a.name_ar}` }));

  // The latest statement of each account: the next one starts the day after, from its closing balance.
  const previous: Record<string, PreviousStatement> = {};
  for (const s of statements) if (!previous[s.account_id]) previous[s.account_id] = { period_to: s.period_to, closing_minor: s.closing_balance_minor };

  // Unmatched lines and the difference, per statement.
  const recon = await Promise.all(
    statements.slice(0, 24).map(async (s) => {
      const { data } = await supabase.rpc("bank_reconciliation", { p_statement_id: s.id });
      return [s.id, data?.[0] ?? null] as const;
    }),
  );
  const reconBy = new Map(recon);

  return (
    <>
      <PageHeader
        title="مطابقة كشف البنك"
        subtitle="أدخل كشف البنك (من ملف Excel أو CSV الذي يصدره البنك) وطابق حركاته مع حركات حساب البنك في الدفاتر"
      />
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="كشف جديد" subtitle="الكشوف متتالية لكل حساب: يبدأ الكشف الجديد من اليوم التالي لآخر كشف وبرصيد إغلاقه" />
          <CardBody>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted">لا يوجد حساب بنك فعّال في دليل الحسابات (1102 أو حساب تحته).</p>
            ) : (
              <BankStatementImport action={createBankStatement} accounts={accounts} today={todayIso()} previous={previous} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="الكشوف" subtitle="الأحدث أولاً" />
          {statements.length === 0 ? (
            <EmptyState>لم يُدخل أي كشف بنك بعد.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>رقم</Th>
                  <Th>الحساب</Th>
                  <Th>الفترة</Th>
                  <Th className="text-end">رصيد أول المدة</Th>
                  <Th className="text-end">رصيد آخر المدة</Th>
                  <Th className="text-end">الحركات</Th>
                  <Th className="text-end">غير مطابقة</Th>
                  <Th className="text-end">الفرق</Th>
                  <Th>الحالة</Th>
                </tr>
              </thead>
              <tbody>
                {statements.map((s) => {
                  const r = reconBy.get(s.id);
                  const acc = s.account as unknown as { code: string; name_ar: string } | null;
                  return (
                    <Tr key={s.id}>
                      <Td className="num font-semibold">
                        <Link href={`/bank/${s.id}`} className="hover:underline">
                          {s.statement_no}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap">
                        <span className="num text-muted">{acc?.code}</span> {acc?.name_ar}
                      </Td>
                      <Td className="num whitespace-nowrap">
                        <Link href={`/bank/${s.id}`} className="hover:underline">
                          {formatDate(s.period_from)} ← {formatDate(s.period_to)}
                        </Link>
                      </Td>
                      <Td className="num text-end">{formatMoney(s.opening_balance_minor, "JOD", { withCurrency: false })}</Td>
                      <Td className="num text-end">{formatMoney(s.closing_balance_minor, "JOD", { withCurrency: false })}</Td>
                      <Td className="num text-end">{formatInt(s.lines_count)}</Td>
                      <Td className="num text-end">{r ? formatInt(r.unmatched_lines) : "—"}</Td>
                      <Td className={`num text-end ${r && r.difference_minor !== 0 ? "font-semibold text-danger" : ""}`}>
                        {r ? formatMoney(r.difference_minor, "JOD", { withCurrency: false }) : "—"}
                      </Td>
                      <Td>{s.status === "closed" ? <Badge tone="success">مطابَق ومغلق</Badge> : <Badge tone="warning">قيد المطابقة</Badge>}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
