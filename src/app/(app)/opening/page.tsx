import type { Metadata } from "next";
import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, sumMinor } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { CONTROL_ACCOUNTS } from "@/lib/opening";
import { CHEQUE_STATUS, ISSUED_CHEQUE_STATUS } from "@/lib/labels";
import {
  deleteOpeningAdvance,
  deleteOpeningBalance,
  deleteOpeningCheque,
  saveOpeningAdvance,
  saveOpeningBalance,
  saveOpeningCheque,
  setOpeningDate,
} from "./actions";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Amount } from "@/components/ledger-bits";
import { DeleteOpeningButton, OpeningAdvanceForm, OpeningBalanceForm, OpeningChequeForm, OpeningDateForm } from "@/components/opening-forms";

export const metadata: Metadata = { title: "الأرصدة الافتتاحية" };

type Row = {
  id: string;
  kind: string;
  debit_minor: number;
  credit_minor: number;
  notes: string | null;
  account: { code: string; name_ar: string } | null;
  client: { name: string } | null;
  supplier: { name: string } | null;
};

const money = (minor: number) => formatMoney(minor, "JOD", { withCurrency: false });

/** Balances on the day the company starts using the system: one entry, the rest to capital. */
export default async function OpeningPage() {
  await requireRole(...FINANCE_ROLES);
  const supabase = await createClient();
  const [settingsRes, rowsRes, advancesRes, inRes, outRes, accountsRes, clientsRes, suppliersRes, driversRes, entryRes] = await Promise.all([
    supabase.from("company_settings").select("opening_date").maybeSingle(),
    supabase
      .from("opening_balances")
      .select("id, kind, debit_minor, credit_minor, notes, account:accounts(code, name_ar), client:clients(name), supplier:suppliers(name)")
      .order("created_at"),
    supabase.from("driver_advances").select("id, amount_base_minor, settlement_id, driver:drivers(full_name)").eq("method", "opening").order("created_at"),
    supabase
      .from("client_receipts")
      .select("id, amount_minor, cheque_no, cheque_bank, cheque_due_date, cheque_status, client:clients(name)")
      .eq("is_opening", true)
      .order("cheque_due_date"),
    supabase
      .from("supplier_payments")
      .select("id, amount_minor, cheque_no, cheque_bank, cheque_due_date, cheque_status, supplier:suppliers(name)")
      .eq("is_opening", true)
      .order("cheque_due_date"),
    supabase.from("accounts").select("id, code, name_ar").eq("is_postable", true).not("code", "in", `(${CONTROL_ACCOUNTS.join(",")})`).order("code"),
    supabase.from("clients").select("id, name").eq("is_active", true).order("name"),
    supabase.from("suppliers").select("id, name").eq("is_active", true).order("name"),
    supabase.from("drivers").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("journal_entries").select("entry_no").eq("source_type", "opening").eq("status", "posted").is("reverses_entry_id", null).maybeSingle(),
  ]);
  const date = settingsRes.data?.opening_date ?? null;
  const rows = (rowsRes.data ?? []) as unknown as Row[];
  const advances = advancesRes.data ?? [];
  const chequesIn = inRes.data ?? [];
  const chequesOut = outRes.data ?? [];
  const byKind = (k: string) => rows.filter((r) => r.kind === k);
  const debit = sumMinor(rows.map((r) => r.debit_minor));
  const credit = sumMinor(rows.map((r) => r.credit_minor));
  const capital = debit - credit;

  const balanceTable = (list: Row[], label: (r: Row) => string, sides: [string, string]) =>
    list.length === 0 ? (
      <EmptyState>لا توجد أرصدة بعد.</EmptyState>
    ) : (
      <Table>
        <thead>
          <tr>
            <Th>البيان</Th>
            <Th className="text-end">{sides[0]}</Th>
            <Th className="text-end">{sides[1]}</Th>
            <Th>ملاحظات</Th>
            <Th>
              <span className="sr-only">إجراءات</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <Tr key={r.id}>
              <Td className="whitespace-nowrap">{label(r)}</Td>
              <Td className="num whitespace-nowrap text-end">
                <Amount minor={r.debit_minor} />
              </Td>
              <Td className="num whitespace-nowrap text-end">
                <Amount minor={r.credit_minor} />
              </Td>
              <Td className="text-xs text-muted">{r.notes ?? ""}</Td>
              <Td>
                <DeleteOpeningButton action={deleteOpeningBalance.bind(null, r.id)} />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    );

  return (
    <>
      <PageHeader
        title="الأرصدة الافتتاحية"
        subtitle="أرصدة يوم بدء العمل على النظام؛ تُرحّل في قيد واحد والفرق إلى رأس المال"
        action={
          <Link href="/import" className={buttonClass("secondary")}>
            <FileSpreadsheet className="size-4" aria-hidden />
            استيراد من Excel
          </Link>
        }
      />
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader
            title="تاريخ بدء العمل"
            subtitle="الأرصدة كما هي صباح هذا اليوم. كل ما يحدث من هذا اليوم فصاعداً يُدخل كحركات عادية."
          />
          <CardBody>
            <OpeningDateForm
              action={setOpeningDate}
              value={date}
              canClear={rows.length === 0 && advances.length === 0 && chequesIn.length === 0 && chequesOut.length === 0}
            />
          </CardBody>
        </Card>

        {!date ? (
          <Card>
            <EmptyState>حدد تاريخ بدء العمل أولاً، ثم أدخل الأرصدة.</EmptyState>
          </Card>
        ) : (
          <>
            <StatGrid>
              <Stat label="مجموع المدين" value={formatMoney(debit, "JOD", { fractionDigits: 0 })} />
              <Stat label="مجموع الدائن" value={formatMoney(credit, "JOD", { fractionDigits: 0 })} />
              <Stat
                label="رأس المال (الفرق)"
                value={formatMoney(Math.abs(capital), "JOD", { fractionDigits: 0 })}
                hint={capital > 0 ? "دائن: حقوق المالك" : capital < 0 ? "مدين: الالتزامات أكبر من الأصول" : "لا فرق"}
                tone={capital < 0 ? "warning" : "neutral"}
              />
              <Stat
                label="القيد الافتتاحي"
                value={
                  entryRes.data ? (
                    <Link href={`/journal?entry=${entryRes.data.entry_no}`} className="text-primary hover:underline">
                      قيد {entryRes.data.entry_no}
                    </Link>
                  ) : (
                    "—"
                  )
                }
                hint={`بتاريخ ${formatDate(date)}`}
              />
            </StatGrid>

            <Card>
              <CardHeader title="الحسابات" subtitle="الصندوق، البنوك، الأصول، القروض، رأس المال وغيرها. أرصدة العملاء والموردين والعهد والشيكات لها أقسامها تحت." />
              {balanceTable(byKind("account"), (r) => `${r.account?.code} ${r.account?.name_ar}`, ["مدين", "دائن"])}
              <CardBody>
                <OpeningBalanceForm
                  action={saveOpeningBalance.bind(null, "account")}
                  options={(accountsRes.data ?? []).map((a) => ({ id: a.id, label: `${a.code} ${a.name_ar}` }))}
                  targetLabel="الحساب"
                  sides={{ debit: "مدين", credit: "دائن" }}
                  defaultSide="debit"
                  idPrefix="ob_acc"
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="أرصدة العملاء" subtitle="المبلغ على الزبون بعد خصم شيكاته الموجودة بالصندوق (الشيكات تُدخل في قسمها)." />
              {balanceTable(byKind("client"), (r) => r.client?.name ?? "", ["عليه", "له"])}
              <CardBody>
                <OpeningBalanceForm
                  action={saveOpeningBalance.bind(null, "client")}
                  options={(clientsRes.data ?? []).map((c) => ({ id: c.id, label: c.name }))}
                  targetLabel="الزبون"
                  sides={{ debit: "عليه (مدين)", credit: "له (دائن)" }}
                  defaultSide="debit"
                  idPrefix="ob_cl"
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="أرصدة الموردين" subtitle="المبلغ المستحق للمورد بعد خصم شيكاتك له التي لم يصرفها البنك (الشيكات تُدخل في قسمها)." />
              {balanceTable(byKind("supplier"), (r) => r.supplier?.name ?? "", ["عليه", "له"])}
              <CardBody>
                <OpeningBalanceForm
                  action={saveOpeningBalance.bind(null, "supplier")}
                  options={(suppliersRes.data ?? []).map((s) => ({ id: s.id, label: s.name }))}
                  targetLabel="المورد"
                  sides={{ debit: "عليه (مدين)", credit: "له (دائن)" }}
                  defaultSide="credit"
                  idPrefix="ob_sp"
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="عهد السائقين المفتوحة" subtitle="المبلغ الذي مع السائق يوم البدء ولم يُسوَّ بعد؛ يُسوّى لاحقاً مثل أي عهدة." />
              {advances.length === 0 ? (
                <EmptyState>لا توجد عهد افتتاحية.</EmptyState>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>السائق</Th>
                      <Th className="text-end">المبلغ</Th>
                      <Th>الحالة</Th>
                      <Th>
                        <span className="sr-only">إجراءات</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {advances.map((a) => (
                      <Tr key={a.id}>
                        <Td className="whitespace-nowrap">{(a.driver as { full_name: string } | null)?.full_name}</Td>
                        <Td className="num whitespace-nowrap text-end">{money(a.amount_base_minor)}</Td>
                        <Td>{a.settlement_id ? <Badge tone="success">مسوّاة</Badge> : <Badge tone="info">مفتوحة</Badge>}</Td>
                        <Td>{a.settlement_id ? null : <DeleteOpeningButton action={deleteOpeningAdvance.bind(null, a.id)} confirmText="حذف هذه العهدة الافتتاحية؟" />}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
              <CardBody>
                <OpeningAdvanceForm action={saveOpeningAdvance} drivers={(driversRes.data ?? []).map((d) => ({ id: d.id, label: d.full_name }))} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="شيكات العملاء بالصندوق" subtitle="شيكات استلمتها قبل يوم البدء ولم تُحصّل؛ تظهر في «شيكات برسم التحصيل» لتعلّمها محصّلة أو مرتجعة." />
              {chequesIn.length === 0 ? (
                <EmptyState>لا توجد شيكات.</EmptyState>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>الزبون</Th>
                      <Th>رقم الشيك</Th>
                      <Th>البنك</Th>
                      <Th>الاستحقاق</Th>
                      <Th className="text-end">المبلغ</Th>
                      <Th>الحالة</Th>
                      <Th>
                        <span className="sr-only">إجراءات</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {chequesIn.map((c) => {
                      const st = CHEQUE_STATUS[c.cheque_status ?? "in_hand"];
                      return (
                        <Tr key={c.id}>
                          <Td className="whitespace-nowrap">{(c.client as { name: string } | null)?.name}</Td>
                          <Td className="num">
                            <span dir="ltr">{c.cheque_no}</span>
                          </Td>
                          <Td className="whitespace-nowrap">{c.cheque_bank ?? "—"}</Td>
                          <Td className="num whitespace-nowrap">{formatDate(c.cheque_due_date)}</Td>
                          <Td className="num whitespace-nowrap text-end">{money(c.amount_minor)}</Td>
                          <Td>
                            <Badge tone={st.tone}>{st.label}</Badge>
                          </Td>
                          <Td>
                            {c.cheque_status === "in_hand" ? (
                              <DeleteOpeningButton action={deleteOpeningCheque.bind(null, "in", c.id)} confirmText="حذف هذا الشيك الافتتاحي؟" />
                            ) : null}
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
              <CardBody>
                <OpeningChequeForm
                  action={saveOpeningCheque.bind(null, "in")}
                  parties={(clientsRes.data ?? []).map((c) => ({ id: c.id, label: c.name }))}
                  partyLabel="الزبون"
                  idPrefix="oc_in"
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="شيكاتنا الصادرة غير المصروفة" subtitle="شيكات أعطيتها للموردين قبل يوم البدء ولم يصرفها البنك؛ تظهر في «شيكات صادرة بانتظار الصرف»." />
              {chequesOut.length === 0 ? (
                <EmptyState>لا توجد شيكات.</EmptyState>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>المورد</Th>
                      <Th>رقم الشيك</Th>
                      <Th>البنك</Th>
                      <Th>الاستحقاق</Th>
                      <Th className="text-end">المبلغ</Th>
                      <Th>الحالة</Th>
                      <Th>
                        <span className="sr-only">إجراءات</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {chequesOut.map((c) => {
                      const st = ISSUED_CHEQUE_STATUS[c.cheque_status ?? "issued"];
                      return (
                        <Tr key={c.id}>
                          <Td className="whitespace-nowrap">{(c.supplier as { name: string } | null)?.name}</Td>
                          <Td className="num">
                            <span dir="ltr">{c.cheque_no}</span>
                          </Td>
                          <Td className="whitespace-nowrap">{c.cheque_bank ?? "—"}</Td>
                          <Td className="num whitespace-nowrap">{formatDate(c.cheque_due_date)}</Td>
                          <Td className="num whitespace-nowrap text-end">{money(c.amount_minor)}</Td>
                          <Td>
                            <Badge tone={st.tone}>{st.label}</Badge>
                          </Td>
                          <Td>
                            {c.cheque_status === "issued" ? (
                              <DeleteOpeningButton action={deleteOpeningCheque.bind(null, "out", c.id)} confirmText="حذف هذا الشيك الافتتاحي؟" />
                            ) : null}
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
              <CardBody>
                <OpeningChequeForm
                  action={saveOpeningCheque.bind(null, "out")}
                  parties={(suppliersRes.data ?? []).map((s) => ({ id: s.id, label: s.name }))}
                  partyLabel="المورد"
                  idPrefix="oc_out"
                />
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
