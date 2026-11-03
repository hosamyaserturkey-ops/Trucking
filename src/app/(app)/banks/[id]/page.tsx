import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Printer } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { filterQuery, sourceHref, sourceLabel, statementFilter } from "@/lib/ledger";
import { loadStatement } from "@/lib/ledger-data";
import { formatMoney } from "@/lib/money";
import { formatDate, formatInt } from "@/lib/format";
import { CHEQUE_STATUS } from "@/lib/labels";
import { deleteBankMovement, saveBankMovement } from "../actions";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { ExportButton } from "@/components/export-button";
import { Amount, Balance, StatementFilters } from "@/components/ledger-bits";
import { BankMovementForm, DeleteMovementButton } from "@/components/bank-account-forms";

export const metadata: Metadata = { title: "كشف حساب البنك" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOOT = "border-b border-border px-3 py-2";
/** Accounts moved only through their own screens. */
const CONTROL = new Set(["1103", "1104", "1105", "2101", "2102"]);
const jod = (minor: number) => formatMoney(minor, "JOD", { withCurrency: false });

/**
 * One bank account's statement (كشف حساب البنك): the opening balance, every
 * movement with its document and the running balance, the cheques still on the
 * way, and a form for the movements no other screen makes.
 */
export default async function BankAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireRole(...FINANCE_ROLES);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const f = statementFilter(sp);
  const supabase = await createClient();

  const { data: bank } = await supabase.from("bank_accounts_v").select("*").eq("account_id", id).maybeSingle();
  if (!bank) notFound();
  const isMain = bank.code === "1102";
  // Cheques of this bank; those naming no bank belong to the main account.
  const ofBank = isMain ? `bank_account_id.is.null,bank_account_id.eq.${id}` : `bank_account_id.eq.${id}`;

  const [st, chequesInRes, chequesOutRes, accountsRes, trucksRes] = await Promise.all([
    loadStatement(id, f, { exact: true }),
    supabase
      .from("client_receipts")
      .select("id, receipt_no, received_on, amount_minor, cheque_no, cheque_bank, cheque_due_date, cheque_status, client:clients(name)")
      .eq("method", "cheque")
      .in("cheque_status", ["in_hand", "deposited"])
      .or(ofBank)
      .order("cheque_due_date"),
    supabase
      .from("supplier_payments")
      .select("id, payment_no, paid_on, amount_minor, cheque_no, cheque_due_date, supplier:suppliers(name)")
      .eq("method", "cheque")
      .eq("cheque_status", "issued")
      .or(ofBank)
      .order("cheque_due_date"),
    supabase.from("accounts").select("id, code, name_ar, type, is_postable, is_active").eq("is_postable", true).order("code"),
    supabase.from("trucks").select("id, code").order("code"),
  ]);
  if (!st) notFound();
  const accounts = (accountsRes.data ?? []).filter((a) => a.is_active);
  const isBank = (a: { code: string; type: string }) => a.type === "asset" && a.code.startsWith("1102");
  const otherBanks = accounts.filter((a) => isBank(a) && a.id !== id).map((a) => ({ id: a.id, label: `${a.code} ${a.name_ar}` }));
  const counterAccounts = accounts.filter((a) => !isBank(a) && !CONTROL.has(a.code)).map((a) => ({ id: a.id, label: `${a.code} ${a.name_ar}` }));
  const chequesIn = chequesInRes.data ?? [];
  const chequesOut = chequesOutRes.data ?? [];
  const today = todayIso();
  const period = `من ${formatDate(f.from)} إلى ${formatDate(f.to)}`;
  const q = filterQuery(f);

  return (
    <>
      <Link href="/banks" className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        الحسابات البنكية
      </Link>
      <PageHeader
        title={`كشف حساب البنك: ${bank.name_ar}`}
        subtitle={`${bank.code}${bank.bank_account_no ? ` · ${bank.bank_account_no}` : ""} · ${period}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link href={`/print/ledger/${id}?${q}&exact=1`} target="_blank" className={buttonClass("secondary")}>
              <Printer className="size-4" aria-hidden />
              طباعة الكشف
            </Link>
            <Link href="/bank" className={buttonClass("secondary")}>
              مطابقة كشف البنك
            </Link>
          </div>
        }
      />
      <StatementFilters action={`/banks/${id}`} filter={f} />

      <div className="flex flex-col gap-5">
        <StatGrid>
          <Stat label="الرصيد في الدفاتر الآن" value={<Balance minor={bank.balance_minor ?? 0} />} hint={bank.last_movement_on ? `آخر حركة ${formatDate(bank.last_movement_on)}` : undefined} />
          <Stat label="شيكات واردة للتحصيل" value={formatMoney(bank.cheques_in_minor ?? 0, "JOD")} hint={`${formatInt(bank.cheques_in_count ?? 0)} شيك`} />
          <Stat
            label="شيكات صادرة لم تُصرف"
            value={formatMoney(bank.cheques_out_minor ?? 0, "JOD")}
            hint={`${formatInt(bank.cheques_out_count ?? 0)} شيك`}
            tone={bank.cheques_out_count ? "warning" : "neutral"}
          />
          <Stat label="الرصيد بعد صرف الشيكات" value={<Balance minor={bank.expected_minor ?? 0} />} />
        </StatGrid>

        <Card>
          <CardHeader
            title="الحركات"
            subtitle={`الوارد للبنك مدين، والصادر منه دائن · ${period}`}
            action={<ExportButton tableId="bank-statement" file="bank-statement" title={`كشف حساب ${bank.code} ${bank.name_ar} ${period} · الرصيد موجب = مدين`} />}
          />
          {st.lines.length === 0 && st.opening === 0 ? (
            <EmptyState>لا توجد حركات في هذه الفترة.</EmptyState>
          ) : (
            <Table id="bank-statement">
              <thead>
                <tr>
                  <Th>التاريخ</Th>
                  <Th>القيد</Th>
                  <Th>البيان</Th>
                  <Th>المستندات</Th>
                  <Th className="text-end">وارد (مدين)</Th>
                  <Th className="text-end">صادر (دائن)</Th>
                  <Th className="text-end">الرصيد</Th>
                  <Th>
                    <span className="sr-only">إجراءات</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-surface-2/60">
                  <Td className="num whitespace-nowrap">{formatDate(f.from)}</Td>
                  <td className="border-b border-border" />
                  <Td className="font-medium">رصيد أول المدة</Td>
                  <td className="border-b border-border" colSpan={3} />
                  <Td className="text-end font-medium">
                    <Balance minor={st.opening} />
                  </Td>
                  <td className="border-b border-border" />
                </tr>
                {st.lines.map((l) => {
                  const href = sourceHref(l.source_type, l.source_id);
                  const docs = [
                    l.voucher_no ? `سند صرف ${l.voucher_no}` : null,
                    l.notice_no ? `إشعار ${l.notice_no}` : null,
                    l.reference_no ? `مرجع ${l.reference_no}` : null,
                    l.cheque_no ? `شيك ${l.cheque_no}` : null,
                    l.receipt_no ? `سند قبض ${l.receipt_no}` : null,
                    l.payment_no ? `دفعة ${l.payment_no}` : null,
                    l.invoice_no ? `فاتورة ${l.invoice_no}` : null,
                  ].filter(Boolean);
                  return (
                    <Tr key={l.id} className={l.is_reversal ? "text-muted" : ""}>
                      <Td className="num whitespace-nowrap">{formatDate(l.entry_date)}</Td>
                      <Td className="num whitespace-nowrap">
                        <Link href={`/journal?entry=${l.entry_no}`} className="hover:underline">
                          {l.entry_no}
                        </Link>
                      </Td>
                      <Td>
                        <Badge>{sourceLabel(l.source_type)}</Badge>{" "}
                        {href ? (
                          <Link href={href} className="hover:underline">
                            {l.description}
                          </Link>
                        ) : (
                          l.description
                        )}
                        {l.party ? <span className="block text-xs text-muted">{l.party}</span> : null}
                      </Td>
                      <Td className="text-xs text-muted">{docs.join(" · ")}</Td>
                      <Td className="num whitespace-nowrap text-end">
                        <Amount minor={l.debit_minor} />
                      </Td>
                      <Td className="num whitespace-nowrap text-end">
                        <Amount minor={l.credit_minor} />
                      </Td>
                      <Td className="text-end">
                        <Balance minor={l.balance_minor} />
                      </Td>
                      <Td className="whitespace-nowrap">
                        {l.source_type === "bank_movement" && l.source_id && !l.is_reversal ? (
                          <DeleteMovementButton action={deleteBankMovement.bind(null, l.source_id)} />
                        ) : null}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2 font-semibold">
                  <td className={FOOT} colSpan={4}>
                    المجموع والرصيد في {formatDate(f.to)}
                  </td>
                  <td className={`num whitespace-nowrap text-end ${FOOT}`}>
                    <Amount minor={st.debit} />
                  </td>
                  <td className={`num whitespace-nowrap text-end ${FOOT}`}>
                    <Amount minor={st.credit} />
                  </td>
                  <td className={`text-end ${FOOT}`}>
                    <Balance minor={st.closing} />
                  </td>
                  <td className={FOOT} />
                </tr>
              </tfoot>
            </Table>
          )}
          {st.truncated ? <p className="px-4 py-3 text-xs text-warning">الفترة فيها أكثر من 1,000 حركة؛ اختر فترة أقصر.</p> : null}
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="شيكات واردة للتحصيل في هذا البنك" subtitle="شيكات الزبائن بالصندوق أو المودعة ولم تُحصّل بعد" />
            {chequesIn.length === 0 ? (
              <EmptyState>لا توجد شيكات واردة معلقة.</EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>الاستحقاق</Th>
                    <Th>الشيك</Th>
                    <Th>الزبون</Th>
                    <Th>الحالة</Th>
                    <Th className="text-end">المبلغ</Th>
                  </tr>
                </thead>
                <tbody>
                  {chequesIn.map((c) => {
                    const s = CHEQUE_STATUS[c.cheque_status ?? "in_hand"];
                    return (
                      <Tr key={c.id}>
                        <Td className={`num whitespace-nowrap ${(c.cheque_due_date ?? "") <= today ? "font-semibold text-warning" : ""}`}>{formatDate(c.cheque_due_date)}</Td>
                        <Td className="num whitespace-nowrap">
                          <Link href="/receipts" className="hover:underline" dir="ltr">
                            {c.cheque_no}
                          </Link>
                          {c.cheque_bank ? <span className="block text-xs text-muted">{c.cheque_bank}</span> : null}
                        </Td>
                        <Td>{(c.client as { name: string } | null)?.name ?? "—"}</Td>
                        <Td>
                          <Badge tone={s.tone}>{s.label}</Badge>
                        </Td>
                        <Td className="num whitespace-nowrap text-end">{jod(c.amount_minor)}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="شيكات صادرة لم يصرفها البنك" subtitle="شيكاتنا المسحوبة على هذا الحساب" />
            {chequesOut.length === 0 ? (
              <EmptyState>لا توجد شيكات صادرة معلقة.</EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>الاستحقاق</Th>
                    <Th>الشيك</Th>
                    <Th>المورد</Th>
                    <Th className="text-end">المبلغ</Th>
                  </tr>
                </thead>
                <tbody>
                  {chequesOut.map((c) => (
                    <Tr key={c.id}>
                      <Td className={`num whitespace-nowrap ${(c.cheque_due_date ?? "") <= today ? "font-semibold text-warning" : ""}`}>{formatDate(c.cheque_due_date)}</Td>
                      <Td className="num whitespace-nowrap">
                        <Link href="/payments" className="hover:underline" dir="ltr">
                          {c.cheque_no}
                        </Link>
                      </Td>
                      <Td>{(c.supplier as { name: string } | null)?.name ?? "—"}</Td>
                      <Td className="num whitespace-nowrap text-end">{jod(c.amount_minor)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader
            title="حركة أخرى على الحساب"
            subtitle="إيداع أو سحب نقدي، تحويل بين البنوك، أموال المالك، عمولات وفوائد. المقبوضات والدفعات والشيكات تُسجّل من شاشاتها."
          />
          <CardBody>
            <BankMovementForm
              action={saveBankMovement.bind(null, id)}
              today={today}
              otherBanks={otherBanks}
              accounts={counterAccounts}
              trucks={(trucksRes.data ?? []).map((t) => ({ id: t.id, label: t.code }))}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
