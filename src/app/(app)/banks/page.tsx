import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { formatMoney, sumMinor } from "@/lib/money";
import { formatDate, formatInt } from "@/lib/format";
import { createBankAccount, updateBankAccount } from "./actions";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { ExportButton } from "@/components/export-button";
import { Balance } from "@/components/ledger-bits";
import { EditBankAccountForm, NewBankAccountForm } from "@/components/bank-account-forms";

export const metadata: Metadata = { title: "الحسابات البنكية" };

const jod = (minor: number) => formatMoney(minor, "JOD", { withCurrency: false });

/**
 * Every bank account: its balance in the books, the cheques still on the way
 * (customers' to collect into it, ours to be paid from it) and the balance once
 * they clear. Each opens its statement.
 */
export default async function BanksPage() {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const { data } = await supabase.from("bank_accounts_v").select("*").order("code");
  const rows = (data ?? []).filter((r) => r.is_active || r.balance_minor);
  const total = (k: "balance_minor" | "cheques_in_minor" | "cheques_out_minor" | "expected_minor") => sumMinor(rows.map((r) => r[k]));

  return (
    <>
      <PageHeader
        title="الحسابات البنكية"
        subtitle="رصيد كل حساب بنكي في الدفاتر، والشيكات التي لم تُصرف بعد"
        action={
          <Link href="/bank" className={buttonClass("secondary")}>
            مطابقة كشف البنك
          </Link>
        }
      />
      <div className="flex flex-col gap-5">
        <StatGrid>
          <Stat label="رصيد البنوك في الدفاتر" value={formatMoney(total("balance_minor"), "JOD", { fractionDigits: 0 })} />
          <Stat label="شيكات واردة للتحصيل" value={formatMoney(total("cheques_in_minor"), "JOD", { fractionDigits: 0 })} hint="شيكات الزبائن بالصندوق أو مودعة" />
          <Stat label="شيكات صادرة لم تُصرف" value={formatMoney(total("cheques_out_minor"), "JOD", { fractionDigits: 0 })} tone={total("cheques_out_minor") ? "warning" : "neutral"} />
          <Stat label="الرصيد بعد صرف الشيكات" value={formatMoney(total("expected_minor"), "JOD", { fractionDigits: 0 })} />
        </StatGrid>

        <Card>
          <CardHeader
            title="الحسابات"
            subtitle="الحساب 1102 هو الحساب الرئيسي، وتُستخدم له أي حركة لم يُحدد بنكها"
            action={<ExportButton tableId="banks-table" file="bank-accounts" title={`الحسابات البنكية في ${formatDate(todayIso())} · بالدينار`} />}
          />
          {rows.length === 0 ? (
            <EmptyState>لا توجد حسابات بنكية.</EmptyState>
          ) : (
            <Table id="banks-table">
              <thead>
                <tr>
                  <Th>الحساب</Th>
                  <Th>رقم الحساب</Th>
                  <Th className="text-end">الرصيد في الدفاتر</Th>
                  <Th className="text-end">شيكات واردة</Th>
                  <Th className="text-end">شيكات صادرة</Th>
                  <Th className="text-end">بعد صرف الشيكات</Th>
                  <Th>آخر حركة</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.account_id}>
                    <Td className="whitespace-nowrap">
                      <Link href={`/banks/${r.account_id}`} className="font-medium text-primary hover:underline">
                        <span className="num">{r.code}</span> {r.name_ar}
                      </Link>
                      {r.code === "1102" ? <span className="ms-1 text-xs text-muted">(الرئيسي)</span> : null}
                      <div className="print:hidden">
                        <EditBankAccountForm action={updateBankAccount.bind(null, r.account_id!)} name={r.name_ar ?? ""} accountNo={r.bank_account_no ?? ""} />
                      </div>
                    </Td>
                    <Td className="num">
                      <span dir="ltr">{r.bank_account_no ?? "—"}</span>
                    </Td>
                    <Td className="text-end font-semibold">
                      <Balance minor={r.balance_minor ?? 0} />
                    </Td>
                    <Td className="num whitespace-nowrap text-end">
                      {r.cheques_in_count ? (
                        <>
                          {jod(r.cheques_in_minor ?? 0)}
                          <span className="block text-xs text-muted">{formatInt(r.cheques_in_count)} شيك</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="num whitespace-nowrap text-end">
                      {r.cheques_out_count ? (
                        <>
                          {jod(r.cheques_out_minor ?? 0)}
                          <span className="block text-xs text-muted">{formatInt(r.cheques_out_count)} شيك</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="text-end">
                      <Balance minor={r.expected_minor ?? 0} />
                    </Td>
                    <Td className="num whitespace-nowrap">{formatDate(r.last_movement_on)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="حساب بنكي جديد" subtitle="يُضاف تحت الحساب 1102 برقم 1102XX، ويظهر في كل نماذج الدفع بالبنك والشيكات" />
          <CardBody>
            <NewBankAccountForm action={createBankAccount} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
