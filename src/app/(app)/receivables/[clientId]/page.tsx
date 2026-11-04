import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Printer } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { loadBankAccounts } from "@/lib/bank-accounts";
import { FINANCE_ROLES } from "@/lib/roles";
import { todayIso } from "@/lib/date-range";
import { filterQuery, statementFilter } from "@/lib/ledger";
import { loadClientLoad, loadClientLoads, loadClientStatement } from "@/lib/receivables-data";
import { invoicePayments, monthlyClaims, payStateTotals } from "@/lib/client-loads";
import { claimStatus } from "@/lib/loading-sheet";
import { INVOICE_PAY_STATE } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { formatDate, formatInt, formatMonth } from "@/lib/format";
import { saveReceipt } from "@/app/(app)/receipts/actions";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Plate } from "@/components/ui/plate";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { ExportButton } from "@/components/export-button";
import { Amount, Balance, StatementFilters } from "@/components/ledger-bits";
import { ReceiptForm } from "@/components/receipt-forms";
import { RefSearch } from "@/components/ref-search";
import { ClaimStatusText } from "@/components/claim-status";

export const metadata: Metadata = { title: "كشف حساب زبون" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOOT = "border-b border-border px-3 py-2";
/** The searched load stands out wherever it appears. */
const PICKED = "outline-2 -outline-offset-2 outline-info";

const jod = (minor: number) => formatMoney(minor, "JOD", { withCurrency: false });

/**
 * A customer's statement: invoices, receipts and bounced cheques with the
 * running balance; the loads not invoiced yet; each invoice with its loads and
 * how far it is paid; loads claimed and not claimed per month. Opened from a
 * reference number (?load=), it starts with that load.
 */
export default async function ClientStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ from?: string; to?: string; load?: string }>;
}) {
  await requireRole(...FINANCE_ROLES);
  const { clientId } = await params;
  if (!UUID.test(clientId)) notFound();
  const sp = await searchParams;
  // This year so far by default.
  const f = statementFilter(sp.from && sp.to ? sp : { from: `${todayIso().slice(0, 4)}-01-01`, to: todayIso() });
  const loadId = sp.load && UUID.test(sp.load) ? sp.load : "";
  const [st, loads, picked] = await Promise.all([
    loadClientStatement(clientId, f),
    loadClientLoads(clientId, f),
    loadId ? loadClientLoad(clientId, loadId) : Promise.resolve(null),
  ]);
  if (!st) notFound();
  const b = st.balance;

  const pay = invoicePayments(loads.invoices, b?.balance_minor ?? 0);
  const periodInvoices = loads.invoices
    .filter((i) => i.invoice_date >= f.from && i.invoice_date <= f.to)
    .map((i) => pay.get(i.id)!)
    .reverse();
  const allPay = payStateTotals([...pay.values()]);
  const months = monthlyClaims(loads.period);
  const monthTotal = months.reduce(
    (t, m) => ({
      claimed: t.claimed + m.claimed.loads,
      claimedMinor: t.claimedMinor + m.claimed.amount_minor,
      unclaimed: t.unclaimed + m.unclaimed.loads,
      unclaimedMinor: t.unclaimedMinor + m.unclaimed.amount_minor,
    }),
    { claimed: 0, claimedMinor: 0, unclaimed: 0, unclaimedMinor: 0 },
  );
  const unbilledMinor = loads.unbilled.reduce((s, l) => s + l.amountMinor, 0);
  const pickedClaim = picked
    ? claimStatus({ status: picked.status, client_id: clientId, is_empty_return: picked.isEmptyReturn, invoice_id: picked.invoiceId })
    : null;
  const pickedPay = picked?.invoiceId ? pay.get(picked.invoiceId) : undefined;
  const period = `من ${formatDate(f.from)} إلى ${formatDate(f.to)}`;

  const bankAccounts = await loadBankAccounts();
  return (
    <>
      <Link href="/receivables" className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        ذمم العملاء
      </Link>
      <PageHeader
        title={`كشف حساب: ${st.client.name}`}
        subtitle={`${period} · مدة السداد ${formatInt(st.client.payment_terms_days)} يوم${st.client.vat_exempt ? " · معفى من الضريبة" : ""}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link href={`/print/receivables/${clientId}?${filterQuery(f)}`} target="_blank" className={buttonClass("secondary")}>
              <Printer className="size-4" aria-hidden />
              طباعة الكشف
            </Link>
            {b?.unbilled_loads ? (
              <Link href={`/invoices/new?client=${clientId}`} className={buttonClass("primary")}>
                فوترة {formatInt(b.unbilled_loads)} نقلة
              </Link>
            ) : null}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <StatementFilters action={`/receivables/${clientId}`} filter={f} />
        <RefSearch defaultValue={picked?.ref ?? ""} className="mb-4" />
      </div>

      <div className="flex flex-col gap-5">
        {picked ? (
          <Card>
            <div id="load" className="scroll-mt-4" />
            <CardHeader
              title={
                <>
                  النقلة <Plate size="md">{picked.ref}</Plate>
                </>
              }
              subtitle="رقم الإشارة يربط النقلة بكشف التحميل وبالفاتورة (المطالبة) وبهذا الكشف"
              action={<ClaimStatusText claim={pickedClaim} />}
            />
            <CardBody>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted">التاريخ</dt>
                  <dd className="num">{formatDate(picked.date)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">الشاحنة والسائق</dt>
                  <dd>
                    <Plate>{picked.truckCode}</Plate> {picked.driver ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">المسار والحمولة</dt>
                  <dd>
                    {picked.route}
                    {picked.cargo ? ` · ${picked.cargo}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">الأجرة</dt>
                  <dd className="num font-semibold">{formatMoney(picked.freightMinor, picked.currency)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">مستند الزبون</dt>
                  <dd className="num" dir="ltr">
                    {picked.docNo ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">الفاتورة (المطالبة)</dt>
                  <dd>
                    {picked.invoiceId && picked.invoiceNo ? (
                      <Link href={`/invoices/${picked.invoiceId}`} className="text-primary hover:underline">
                        فاتورة <span className="num">{picked.invoiceNo}</span> · <span className="num">{formatDate(picked.invoiceDate)}</span>
                      </Link>
                    ) : (
                      <span className="text-danger">لم تُفوتر بعد</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">الدفع</dt>
                  <dd>
                    {pickedPay ? (
                      <>
                        <Badge tone={INVOICE_PAY_STATE[pickedPay.state].tone}>{INVOICE_PAY_STATE[pickedPay.state].label}</Badge>
                        {pickedPay.remaining_minor ? <span className="num ms-1 text-xs text-muted">باقي {jod(pickedPay.remaining_minor)}</span> : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <Link href={`/loading?date=${picked.date}&client=${clientId}`} className="text-xs text-primary hover:underline">
                    كشف التحميل لذلك اليوم
                  </Link>
                  <Link href={`/trips/${picked.id}`} className="text-xs text-primary hover:underline">
                    صفحة النقلة
                  </Link>
                  {!picked.invoiceId && pickedClaim ? (
                    <Link href={`/invoices/new?client=${clientId}`} className="text-xs text-primary hover:underline">
                      فوترة
                    </Link>
                  ) : null}
                </div>
              </dl>
            </CardBody>
          </Card>
        ) : null}

        <StatGrid>
          <Stat label="الرصيد الآن" value={<Balance minor={b?.balance_minor ?? 0} />} />
          <Stat label="مستحق متأخر" value={formatMoney(b?.overdue_minor ?? 0, "JOD")} tone={b?.overdue_minor ? "danger" : "success"} />
          <Stat label="شيكات برسم التحصيل" value={formatMoney(b?.cheques_pending_minor ?? 0, "JOD")} />
          <Stat
            label="لم تتم المطالبة (غير مفوترة)"
            value={formatMoney(b?.unbilled_minor ?? 0, "JOD")}
            hint={`${formatInt(b?.unbilled_loads ?? 0)} نقلة`}
            tone={b?.unbilled_loads ? "danger" : "neutral"}
          />
          <Stat label="فواتير مدفوعة" value={formatInt(allPay.paid.count)} hint={formatMoney(allPay.paid.total_minor, "JOD")} tone="success" />
          <Stat
            label="فواتير مدفوعة جزئياً"
            value={formatInt(allPay.partial.count)}
            hint={`باقي ${formatMoney(allPay.partial.remaining_minor, "JOD")}`}
            tone={allPay.partial.count ? "warning" : "neutral"}
          />
          <Stat
            label="فواتير غير مدفوعة"
            value={formatInt(allPay.unpaid.count)}
            hint={formatMoney(allPay.unpaid.remaining_minor, "JOD")}
            tone={allPay.unpaid.count ? "danger" : "neutral"}
          />
          <Stat label="نقلات الفترة" value={formatInt(monthTotal.claimed + monthTotal.unclaimed)} hint={`${formatInt(monthTotal.claimed)} مفوترة · ${formatInt(monthTotal.unclaimed)} غير مفوترة`} />
        </StatGrid>

        <Card>
          <CardHeader title="الحركات" subtitle="الفواتير مدينة، والمقبوضات دائنة، والشيك المرتجع مدين من جديد" action={<ExportButton tableId="client-statement" file="customer-statement" title={`كشف حساب ${st.client.name} ${period} · الرصيد موجب = مدين، سالب = دائن`} />} />
          {st.lines.length === 0 && st.opening === 0 ? (
            <EmptyState>لا توجد حركات في هذه الفترة.</EmptyState>
          ) : (
            <Table id="client-statement">
              <thead>
                <tr>
                  <Th>التاريخ</Th>
                  <Th>البيان</Th>
                  <Th>التفاصيل</Th>
                  <Th className="text-end">مدين</Th>
                  <Th className="text-end">دائن</Th>
                  <Th className="text-end">الرصيد</Th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-surface-2/60">
                  <Td className="num whitespace-nowrap">{formatDate(f.from)}</Td>
                  <Td className="font-medium">رصيد أول المدة</Td>
                  <td className="border-b border-border" colSpan={3} />
                  <Td className="text-end font-medium">
                    <Balance minor={st.opening} />
                  </Td>
                </tr>
                {st.lines.map((l) => (
                  <Tr
                    key={l.key}
                    className={`${l.kind === "bounced" ? "text-danger" : ""} ${l.kind === "invoice" && picked?.invoiceId === l.docId ? PICKED : ""}`}
                  >
                    <Td className="num whitespace-nowrap">{formatDate(l.date)}</Td>
                    <Td className="whitespace-nowrap">
                      {l.kind === "opening" ? (
                        l.description
                      ) : (
                        <Link href={l.kind === "invoice" ? `/invoices/${l.docId}` : `/print/receipts/${l.docId}`} className="hover:underline">
                          {l.description}
                        </Link>
                      )}
                    </Td>
                    <Td className="text-xs text-muted">{l.details ?? ""}</Td>
                    <Td className="num whitespace-nowrap text-end">
                      <Amount minor={l.debit_minor} />
                    </Td>
                    <Td className="num whitespace-nowrap text-end">
                      <Amount minor={l.credit_minor} />
                    </Td>
                    <Td className="text-end">
                      <Balance minor={l.balance_minor} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2 font-semibold">
                  <td className={FOOT} colSpan={3}>
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
                </tr>
              </tfoot>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader
            title="نقلات لم تتم المطالبة بها"
            subtitle={`كل النقلات المنتهية التي لم تُفوتر بعد، بأي تاريخ · ${formatInt(loads.unbilled.length)} نقلة · ${formatMoney(unbilledMinor, "JOD")}`}
            action={
              <div className="flex flex-wrap items-center gap-3">
                <ExportButton tableId="client-unbilled" file="customer-unbilled-loads" title={`نقلات ${st.client.name} غير المفوترة في ${formatDate(todayIso())}`} />
                {loads.unbilled.length ? (
                  <Link href={`/invoices/new?client=${clientId}`} className={buttonClass("primary")}>
                    فوترة
                  </Link>
                ) : null}
              </div>
            }
          />
          {loads.unbilled.length === 0 ? (
            <EmptyState>كل نقلات هذا الزبون مفوترة.</EmptyState>
          ) : (
            <Table id="client-unbilled">
              <thead>
                <tr>
                  <Th>رقم الإشارة</Th>
                  <Th>التاريخ</Th>
                  <Th>الشاحنة</Th>
                  <Th>المسار</Th>
                  <Th>الحمولة</Th>
                  <Th>مستند الزبون</Th>
                  <Th className="text-end">الأجرة</Th>
                  <Th className="text-end">بالدينار</Th>
                </tr>
              </thead>
              <tbody>
                {loads.unbilled.map((l) => (
                  <Tr key={l.id} tone="danger" className={l.id === loadId ? PICKED : ""}>
                    <Td className="num whitespace-nowrap font-medium">
                      <Link href={`/trips/${l.id}`} className="hover:underline" dir="ltr">
                        <Plate>{l.ref}</Plate>
                      </Link>
                    </Td>
                    <Td className="num whitespace-nowrap">{formatDate(l.date)}</Td>
                    <Td className="whitespace-nowrap">
                      <Plate>{l.truckCode}</Plate>
                    </Td>
                    <Td className="whitespace-nowrap">{l.route}</Td>
                    <Td>{l.cargo ?? "—"}</Td>
                    <Td className="num">
                      <span dir="ltr">{l.docNo ?? "—"}</span>
                    </Td>
                    <Td className="num whitespace-nowrap text-end">{formatMoney(l.freightMinor, l.currency)}</Td>
                    <Td className="num whitespace-nowrap text-end">{jod(l.amountMinor)}</Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2 font-semibold">
                  <td className={FOOT} colSpan={7}>
                    المجموع: {formatInt(loads.unbilled.length)} نقلة
                  </td>
                  <td className={`num whitespace-nowrap text-end ${FOOT}`}>{jod(unbilledMinor)}</td>
                </tr>
              </tfoot>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader
            title="الفواتير ونقلاتها"
            subtitle={`فواتير الفترة، الأحدث أولاً · الدفعات تسدد الأقدم أولاً، والشيك برسم التحصيل يُحسب مدفوعاً`}
            action={<ExportButton tableId="client-invoices" file="customer-invoices" title={`فواتير ${st.client.name} ونقلاتها ${period}`} />}
          />
          {periodInvoices.length === 0 ? (
            <EmptyState>لا توجد فواتير في هذه الفترة.</EmptyState>
          ) : (
            <Table id="client-invoices">
              <thead>
                <tr>
                  <Th>الفاتورة / رقم الإشارة</Th>
                  <Th>التاريخ</Th>
                  <Th>الاستحقاق / المسار</Th>
                  <Th>الحالة / مستند الزبون</Th>
                  <Th className="text-end">المبلغ</Th>
                  <Th className="text-end">المدفوع</Th>
                  <Th className="text-end">الباقي</Th>
                </tr>
              </thead>
              <tbody>
                {periodInvoices.map((i) => {
                  const ps = INVOICE_PAY_STATE[i.state];
                  const overdue = i.remaining_minor > 0 && i.due_date < todayIso();
                  return [
                    <tr key={i.id} className={`bg-surface-2 font-semibold ${picked?.invoiceId === i.id ? PICKED : ""}`}>
                      <Td className="whitespace-nowrap">
                        <Link href={`/invoices/${i.id}`} className="text-primary hover:underline">
                          فاتورة <span className="num">{i.invoice_no}</span>
                        </Link>
                        <span className="ms-1 text-xs font-normal text-muted">{formatInt(i.lines_count)} نقلة</span>
                      </Td>
                      <Td className="num whitespace-nowrap">{formatDate(i.invoice_date)}</Td>
                      <Td className={`num whitespace-nowrap ${overdue ? "text-danger" : ""}`}>
                        {formatDate(i.due_date)}
                        {overdue ? <span className="ms-1 text-xs">متأخرة</span> : null}
                      </Td>
                      <Td className="whitespace-nowrap">
                        <Badge tone={ps.tone}>{ps.label}</Badge>
                      </Td>
                      <Td className="num whitespace-nowrap text-end">{jod(i.total_minor)}</Td>
                      <Td className="num whitespace-nowrap text-end">{jod(i.paid_minor)}</Td>
                      <Td className={`num whitespace-nowrap text-end ${i.remaining_minor ? "text-danger" : ""}`}>{jod(i.remaining_minor)}</Td>
                    </tr>,
                    ...(loads.linesByInvoice.get(i.id) ?? []).map((l) => (
                      <Tr key={`${i.id}-${l.line_no}`} tone="success" className={`text-xs ${l.trip_id && l.trip_id === loadId ? PICKED : ""}`}>
                        <Td className="num whitespace-nowrap ps-6">
                          {l.trip_id ? (
                            <Link href={`/trips/${l.trip_id}`} className="hover:underline" dir="ltr">
                              <Plate>{l.client_ref}</Plate>
                            </Link>
                          ) : (
                            <Plate>{l.client_ref}</Plate>
                          )}
                        </Td>
                        <Td className="num whitespace-nowrap">{formatDate(l.load_date)}</Td>
                        <Td>
                          {l.route ?? "—"}
                          {l.cargo_description ? <span className="text-muted"> · {l.cargo_description}</span> : null}
                        </Td>
                        <Td className="num">
                          <span dir="ltr">{l.client_doc_no ?? ""}</span>
                        </Td>
                        <Td className="num whitespace-nowrap text-end">{jod(l.amount_minor)}</Td>
                        <Td />
                        <Td />
                      </Tr>
                    )),
                  ];
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader
            title="النقلات حسب الشهر"
            subtitle={`نقلات الفترة حسب تاريخ التحميل: ما تمت المطالبة به (مفوتر) وما لم تتم بعد`}
            action={<ExportButton tableId="client-months" file="customer-loads-by-month" title={`نقلات ${st.client.name} حسب الشهر ${period}`} />}
          />
          {months.length === 0 ? (
            <EmptyState>لا توجد نقلات في هذه الفترة.</EmptyState>
          ) : (
            <Table id="client-months">
              <thead>
                <tr>
                  <Th>الشهر</Th>
                  <Th className="text-end">نقلات تمت المطالبة بها</Th>
                  <Th className="text-end">مبلغها</Th>
                  <Th className="text-end">نقلات لم تتم المطالبة بها</Th>
                  <Th className="text-end">مبلغها</Th>
                  <Th className="text-end">كل النقلات</Th>
                  <Th className="text-end">المبلغ</Th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <Tr key={m.month}>
                    <Td className="whitespace-nowrap">{formatMonth(`${m.month}-01`)}</Td>
                    <Td className="num text-end text-success">{formatInt(m.claimed.loads)}</Td>
                    <Td className="num whitespace-nowrap text-end text-success">{jod(m.claimed.amount_minor)}</Td>
                    <Td className={`num text-end ${m.unclaimed.loads ? "font-semibold text-danger" : "text-muted"}`}>{formatInt(m.unclaimed.loads)}</Td>
                    <Td className={`num whitespace-nowrap text-end ${m.unclaimed.loads ? "font-semibold text-danger" : "text-muted"}`}>{jod(m.unclaimed.amount_minor)}</Td>
                    <Td className="num text-end">{formatInt(m.claimed.loads + m.unclaimed.loads)}</Td>
                    <Td className="num whitespace-nowrap text-end">{jod(m.claimed.amount_minor + m.unclaimed.amount_minor)}</Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2 font-semibold">
                  <td className={FOOT}>المجموع</td>
                  <td className={`num text-end ${FOOT}`}>{formatInt(monthTotal.claimed)}</td>
                  <td className={`num whitespace-nowrap text-end ${FOOT}`}>{jod(monthTotal.claimedMinor)}</td>
                  <td className={`num text-end ${FOOT}`}>{formatInt(monthTotal.unclaimed)}</td>
                  <td className={`num whitespace-nowrap text-end ${FOOT}`}>{jod(monthTotal.unclaimedMinor)}</td>
                  <td className={`num text-end ${FOOT}`}>{formatInt(monthTotal.claimed + monthTotal.unclaimed)}</td>
                  <td className={`num whitespace-nowrap text-end ${FOOT}`}>{jod(monthTotal.claimedMinor + monthTotal.unclaimedMinor)}</td>
                </tr>
              </tfoot>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="قبض دفعة من هذا الزبون" />
          <CardBody>
            <ReceiptForm bankAccounts={bankAccounts} action={saveReceipt} clients={[{ id: st.client.id, label: st.client.name }]} today={todayIso()} clientId={st.client.id} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
