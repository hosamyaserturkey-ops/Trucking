import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Printer } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/date-range";
import { reconciliationLines } from "@/lib/bank";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, formatInt } from "@/lib/format";
import { sourceHref } from "@/lib/ledger";
import {
  addBankLine,
  autoMatchBank,
  closeBankStatement,
  deleteBankLine,
  deleteBankStatement,
  matchBankLines,
  postBankLine,
  reopenBankStatement,
  unmatchBank,
} from "../actions";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { BankButton, BankMatcher, ManualBankLineForm, PostBankLineForm, type MatchBookLine } from "@/components/bank-forms";

export const metadata: Metadata = { title: "مطابقة كشف البنك" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jod = (minor: number) => formatMoney(minor, "JOD", { withCurrency: false });

/** The reconciliation workspace for one statement. */
export default async function BankStatementPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(...FINANCE_ROLES);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const { data: st } = await supabase
    .from("bank_statements")
    .select("id, statement_no, account_id, period_from, period_to, opening_balance_minor, closing_balance_minor, lines_count, source_name, notes, status, closed_at, account:accounts(code, name_ar)")
    .eq("id", id)
    .maybeSingle();
  if (!st) notFound();
  const isOpen = st.status === "open";

  const [reconRes, linesRes, bookRes, matchesRes, accountsRes, trucksRes, prevRes] = await Promise.all([
    supabase.rpc("bank_reconciliation", { p_statement_id: id }),
    supabase.from("bank_statement_lines").select("id, line_no, txn_date, description, reference, amount_minor, match_id").eq("statement_id", id).order("line_no").limit(3000),
    supabase
      .from("bank_book_lines_v")
      .select("id, entry_no, entry_date, entry_description, amount_minor, cheque_no, notice_no, voucher_no, reference_no, party, source_type, source_id")
      .eq("account_id", st.account_id)
      .is("match_id", null)
      .eq("is_opening", false)
      .eq("is_cancelled", false)
      .gte("entry_date", addDays(st.period_from, -60))
      .lte("entry_date", addDays(st.period_to, 31))
      .order("entry_date")
      .order("entry_no")
      .limit(1000),
    supabase.from("bank_matches_v").select("id, kind, done_on, bank_minor").eq("statement_id", id).order("created_at"),
    supabase.from("accounts").select("id, code, name_ar, type, is_postable, is_active").eq("is_postable", true).eq("is_active", true).order("code"),
    supabase.from("trucks").select("id, code, plate_number").eq("is_active", true).order("code"),
    supabase
      .from("bank_statements")
      .select("statement_no, period_to, closing_balance_minor")
      .eq("account_id", st.account_id)
      .lt("period_to", st.period_from)
      .order("period_to", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const r = reconRes.data?.[0];
  const lines = linesRes.data ?? [];
  const matches = matchesRes.data ?? [];
  const matchIds = matches.map((m) => m.id!);
  const { data: matchedBook } = matchIds.length
    ? await supabase
        .from("bank_book_lines_v")
        .select("id, entry_no, entry_date, entry_description, amount_minor, cheque_no, notice_no, voucher_no, match_id, source_type, source_id")
        .in("match_id", matchIds)
    : { data: [] };
  const acc = st.account as unknown as { code: string; name_ar: string } | null;
  const prev = prevRes.data;
  const gap = prev && (prev.closing_balance_minor !== st.opening_balance_minor || addDays(prev.period_to, 1) !== st.period_from);

  const blocked = new Set(["1103", "1104", "1105", "2101", "2102"]);
  const postAccounts = (accountsRes.data ?? [])
    .filter((a) => !a.code.startsWith("1102") && !blocked.has(a.code))
    .map((a) => ({ id: a.id, code: a.code, label: `${a.code} ${a.name_ar}` }));
  const accountId = (code: string) => postAccounts.find((a) => a.code === code)?.id ?? postAccounts[0]?.id ?? "";
  const trucks = (trucksRes.data ?? []).map((t) => ({ id: t.id, label: `${t.code} · ${t.plate_number}` }));

  const unmatchedBank = lines.filter((l) => !l.match_id);
  const book: MatchBookLine[] = (bookRes.data ?? []).map((b) => ({
    id: b.id!,
    entry_no: b.entry_no!,
    date: b.entry_date!,
    description: b.entry_description ?? "",
    reference: b.cheque_no ?? b.notice_no ?? b.voucher_no ?? b.reference_no ?? null,
    party: b.party,
    amount: b.amount_minor!,
    note: b.entry_date! > st.period_to ? "بعد نهاية الكشف" : b.entry_date! < st.period_from ? "قبل بداية الكشف" : null,
  }));
  const postForms = isOpen
    ? Object.fromEntries(
        unmatchedBank.map((l) => [
          l.id,
          <PostBankLineForm
            key={l.id}
            action={postBankLine.bind(null, id, l.id)}
            accounts={postAccounts}
            trucks={trucks}
            defaultAccountId={accountId(l.amount_minor < 0 ? "5204" : "4102")}
            description={l.description}
          />,
        ]),
      )
    : {};
  const rec = r ? reconciliationLines(r) : null;

  return (
    <>
      <Link href="/bank" className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        مطابقة البنك
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            كشف البنك <span className="num">#{st.statement_no}</span>
            {isOpen ? <Badge tone="warning">قيد المطابقة</Badge> : <Badge tone="success">مطابَق ومغلق</Badge>}
          </span>
        }
        subtitle={
          <>
            <span className="num">{acc?.code}</span> {acc?.name_ar} · <span className="num">{formatDate(st.period_from)}</span> ←{" "}
            <span className="num">{formatDate(st.period_to)}</span> · <span className="num">{formatInt(st.lines_count)}</span> حركة
            {st.source_name ? (
              <>
                {" "}
                · <span dir="ltr">{st.source_name}</span>
              </>
            ) : null}
          </>
        }
        action={
          <Link href={`/print/bank/${id}`} target="_blank" className={buttonClass("secondary")}>
            <Printer className="size-4" aria-hidden />
            تقرير المطابقة
          </Link>
        }
      />

      <div className="flex flex-col gap-5">
        {gap ? (
          <p className="rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
            الكشف السابق رقم <span className="num">{prev?.statement_no}</span> ينتهي في <span className="num">{formatDate(prev?.period_to)}</span> برصيد{" "}
            <span className="num">{jod(prev?.closing_balance_minor ?? 0)}</span>؛ هذا الكشف لا يكمله تماماً (تاريخ البداية أو رصيد أول المدة). تأكد من عدم وجود حركات ناقصة.
          </p>
        ) : null}

        {r && rec ? (
          <Card>
            <CardHeader title="المطابقة كما في نهاية الكشف" subtitle={`حتى ${formatDate(r.as_of)} · بالدينار`} />
            <CardBody className="grid gap-6 md:grid-cols-2">
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
                <dt>رصيد كشف البنك</dt>
                <dd className="num text-end font-semibold">{jod(r.bank_balance_minor)}</dd>
                <dt className="text-muted">+ إيداعات في الدفاتر لم تظهر في البنك</dt>
                <dd className="num text-end">{jod(r.outstanding_in_minor)}</dd>
                <dt className="text-muted">− دفعات وشيكات في الدفاتر لم تُصرف بعد</dt>
                <dd className="num text-end">{jod(r.outstanding_out_minor)}</dd>
                <dt className="border-t border-border pt-1.5 font-semibold">الرصيد المعدّل حسب البنك</dt>
                <dd className="num border-t border-border pt-1.5 text-end font-semibold">{jod(rec.adjustedBank)}</dd>
              </dl>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
                <dt>رصيد حساب البنك في الدفاتر</dt>
                <dd className="num text-end font-semibold">{jod(r.book_balance_minor)}</dd>
                <dt className="text-muted">+ إيداعات في البنك غير مسجلة في الدفاتر</dt>
                <dd className="num text-end">{jod(r.unrecorded_in_minor)}</dd>
                <dt className="text-muted">− خصومات في البنك غير مسجلة في الدفاتر</dt>
                <dd className="num text-end">{jod(r.unrecorded_out_minor)}</dd>
                <dt className="border-t border-border pt-1.5 font-semibold">الرصيد المعدّل حسب الدفاتر</dt>
                <dd className="num border-t border-border pt-1.5 text-end font-semibold">{jod(rec.adjustedBook)}</dd>
              </dl>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-3 md:col-span-2">
                <p className={`text-base font-bold ${r.difference_minor === 0 ? "text-success" : "text-danger"}`}>
                  الفرق: <span className="num">{jod(r.difference_minor)}</span>
                  {r.difference_minor === 0 ? " — متطابق" : ""}
                </p>
                <p className="text-sm text-muted">
                  غير مطابق في الكشف: <span className="num">{formatInt(r.unmatched_lines)}</span>
                </p>
                {isOpen ? (
                  <BankButton
                    action={closeBankStatement.bind(null, id)}
                    label="إغلاق الكشف كمطابَق"
                    variant="primary"
                    confirmText="إغلاق الكشف؟ لا تتغير حركاته ولا مطابقاته بعد الإغلاق."
                  />
                ) : (
                  <BankButton action={reopenBankStatement.bind(null, id)} label="إعادة فتح الكشف" confirmText="إعادة فتح الكشف للتعديل؟" />
                )}
              </div>
              {r.difference_minor !== 0 ? (
                <p className="text-sm text-muted md:col-span-2">
                  الفرق لا يتغير بالمطابقة: مصدره رصيد أول المدة أو حركة ناقصة في الكشف. تأكد أن رصيد أول المدة يطابق رصيد الدفاتر في بداية الكشف مع الشيكات المعلقة يومها، وأن كل حركات البنك في الفترة موجودة.
                </p>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        {isOpen ? (
          <Card>
            <CardHeader
              title="المطابقة"
              subtitle="حدد حركة أو أكثر من كل جانب بنفس المجموع ثم «مطابقة المحدد». حركة البنك غير الموجودة في الدفاتر (عمولة، فائدة) تُرحّل من مكانها."
              action={<BankButton action={autoMatchBank.bind(null, id)} label="مطابقة تلقائية" />}
            />
            <CardBody>
              <BankMatcher
                action={matchBankLines.bind(null, id)}
                bankLines={unmatchedBank.map((l) => ({
                  id: l.id,
                  line_no: l.line_no,
                  date: l.txn_date,
                  description: l.description,
                  reference: l.reference,
                  amount: l.amount_minor,
                }))}
                bookLines={book}
                postForms={postForms}
              />
              {(bookRes.data ?? []).length >= 1000 ? (
                <p className="mt-2 text-xs text-muted">تظهر أول 1,000 حركة من الدفاتر فقط.</p>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="الحركات المطابقة" subtitle={`${formatInt(matches.length)} مطابقة`} />
          {matches.length === 0 ? (
            <EmptyState>لا توجد مطابقات بعد.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {matches.map((m) => {
                const bankSide = lines.filter((l) => l.match_id === m.id);
                const bookSide = (matchedBook ?? []).filter((b) => b.match_id === m.id);
                return (
                  <li key={m.id} className="grid gap-2 px-4 py-2.5 text-sm md:grid-cols-[1fr_1fr_auto]">
                    <div>
                      {bankSide.map((l) => (
                        <p key={l.id}>
                          <span className="num text-xs text-muted">
                            {l.line_no} · {formatDate(l.txn_date)}
                          </span>{" "}
                          {l.description || "—"} <span className="num font-medium">{jod(l.amount_minor)}</span>
                        </p>
                      ))}
                      {bankSide.length === 0 ? <p className="text-xs text-muted">قيد وعكسه في الدفاتر</p> : null}
                    </div>
                    <div>
                      {bookSide.map((b) => {
                        const href = sourceHref(b.source_type, b.source_id);
                        return (
                          <p key={b.id}>
                            <Link href={`/journal?entry=${b.entry_no}`} className="num text-xs text-muted hover:underline">
                              قيد {b.entry_no}
                            </Link>{" "}
                            <span className="num text-xs text-muted">{formatDate(b.entry_date)}</span>{" "}
                            {href ? (
                              <Link href={href} className="hover:underline">
                                {b.entry_description}
                              </Link>
                            ) : (
                              b.entry_description
                            )}{" "}
                            <span className="num font-medium">{jod(b.amount_minor ?? 0)}</span>
                          </p>
                        );
                      })}
                    </div>
                    <div className="flex items-start gap-2">
                      {m.kind === "posted" ? <Badge tone="info">رُحّل من الكشف</Badge> : null}
                      {isOpen ? (
                        <BankButton
                          action={unmatchBank.bind(null, id, m.id!)}
                          label="إلغاء"
                          small
                          variant="danger"
                          confirmText={m.kind === "posted" ? "إلغاء المطابقة؟ يُعكس القيد الذي رُحّل من الكشف." : "إلغاء هذه المطابقة؟"}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {isOpen ? (
          <Card>
            <CardHeader title="إضافة حركة يدوياً" subtitle="لحركة ناقصة في الملف، أو لإدخال الكشف كله يدوياً" />
            <CardBody className="flex flex-col gap-4">
              <ManualBankLineForm action={addBankLine.bind(null, id)} from={st.period_from} to={st.period_to} />
              {unmatchedBank.length > 0 ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted">حذف حركة أُدخلت بالخطأ</summary>
                  <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                    {unmatchedBank.map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                        <span>
                          <span className="num text-xs text-muted">
                            {l.line_no} · {formatDate(l.txn_date)}
                          </span>{" "}
                          {l.description} <span className="num">{jod(l.amount_minor)}</span>
                        </span>
                        <BankButton action={deleteBankLine.bind(null, id, l.id)} label="حذف" small variant="danger" confirmText="حذف هذه الحركة من الكشف؟" />
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        {isOpen ? (
          <div>
            <BankButton
              action={deleteBankStatement.bind(null, id)}
              label="حذف الكشف كاملاً"
              variant="danger"
              confirmText="حذف الكشف وكل مطابقاته؟ القيود المرحّلة منه تبقى في الدفاتر."
            />
          </div>
        ) : (
          <p className="text-sm text-muted">
            أُغلق في <span className="num">{formatDateTime(st.closed_at)}</span>.
          </p>
        )}
      </div>
    </>
  );
}
