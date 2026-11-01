import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { reconciliationLines } from "@/lib/bank";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, formatInt } from "@/lib/format";
import { PrintButton } from "@/components/print-button";

export const metadata: Metadata = { title: "تقرير مطابقة البنك" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jod = (minor: number) => formatMoney(minor, "JOD", { withCurrency: false });
const CELL = "border border-border px-2 py-1";

// A4 bank reconciliation statement (كشف مطابقة البنك) as of the statement's last day.
export default async function BankReconciliationPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole(...FINANCE_ROLES);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const { data: st } = await supabase
    .from("bank_statements")
    .select("id, statement_no, account_id, period_from, period_to, opening_balance_minor, closing_balance_minor, lines_count, status, closed_at, account:accounts(code, name_ar)")
    .eq("id", id)
    .maybeSingle();
  if (!st) notFound();
  const [reconRes, outRes, settingsRes] = await Promise.all([
    supabase.rpc("bank_reconciliation", { p_statement_id: id }),
    supabase.rpc("bank_outstanding", { p_account_id: st.account_id, p_as_of: st.period_to }).limit(1000),
    supabase.from("company_settings").select("company_name, address, phone").maybeSingle(),
  ]);
  const r = reconRes.data?.[0];
  if (!r) notFound();
  const rec = reconciliationLines(r);
  const out = outRes.data ?? [];
  const book = out.filter((o) => o.side === "book").sort((a, b) => a.line_date.localeCompare(b.line_date));
  const bank = out.filter((o) => o.side === "bank").sort((a, b) => a.line_date.localeCompare(b.line_date));
  const company = settingsRes.data;
  const acc = st.account as unknown as { code: string; name_ar: string } | null;

  const list = (title: string, rows: typeof out, empty: string) => (
    <section className="mt-4 break-inside-avoid">
      <h2 className="mb-1 font-bold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-muted">{empty}</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-surface-2">
              <th className={`${CELL} text-start`}>التاريخ</th>
              <th className={`${CELL} text-start`}>البيان</th>
              <th className={`${CELL} text-start`}>المرجع</th>
              <th className={`${CELL} text-end`}>إيداع</th>
              <th className={`${CELL} text-end`}>سحب</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.line_id}>
                <td className={`${CELL} num whitespace-nowrap`}>{formatDate(o.line_date)}</td>
                <td className={CELL}>
                  {o.entry_no ? <span className="num text-muted">قيد {o.entry_no} · </span> : null}
                  {o.description}
                </td>
                <td className={`${CELL} num`} dir="ltr">
                  {o.reference ?? ""}
                </td>
                <td className={`${CELL} num text-end`}>{o.amount_minor > 0 ? jod(o.amount_minor) : ""}</td>
                <td className={`${CELL} num text-end`}>{o.amount_minor < 0 ? jod(-o.amount_minor) : ""}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={CELL} colSpan={3}>
                المجموع ({formatInt(rows.length)})
              </td>
              <td className={`${CELL} num text-end`}>{jod(rows.filter((o) => o.amount_minor > 0).reduce((s, o) => s + o.amount_minor, 0))}</td>
              <td className={`${CELL} num text-end`}>{jod(-rows.filter((o) => o.amount_minor < 0).reduce((s, o) => s + o.amount_minor, 0))}</td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );

  const line = (label: string, minor: number, strong = false) => (
    <div className={`flex justify-between gap-4 py-1 ${strong ? "border-t border-text font-bold" : ""}`}>
      <span>{label}</span>
      <span className="num">{jod(minor)}</span>
    </div>
  );

  return (
    <main className="mx-auto max-w-[210mm] bg-surface p-6 text-[12px] leading-relaxed print:max-w-none print:p-0">
      <style>{`@page { size: A4; margin: 12mm; }`}</style>
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton />
      </div>
      <header className="flex items-start justify-between gap-4 border-b-2 border-text pb-3">
        <div>
          <p className="text-lg font-bold">{company?.company_name ?? "شركة النقل"}</p>
          {company?.address ? <p className="text-xs">{company.address}</p> : null}
          {company?.phone ? (
            <p className="text-xs">
              هاتف: <span dir="ltr">{company.phone}</span>
            </p>
          ) : null}
        </div>
        <div className="text-start">
          <h1 className="text-xl font-bold">كشف مطابقة البنك</h1>
          <p>
            الحساب: <span className="num">{acc?.code}</span> {acc?.name_ar}
          </p>
          <p>
            كشف البنك رقم <span className="num">{st.statement_no}</span>: <span className="num">{formatDate(st.period_from)}</span> ←{" "}
            <span className="num">{formatDate(st.period_to)}</span>
          </p>
          <p>
            كما في: <span className="num font-semibold">{formatDate(r.as_of)}</span> · المبالغ بالدينار
          </p>
        </div>
      </header>

      <section className="mt-4 grid grid-cols-2 gap-8">
        <div>
          {line("رصيد كشف البنك", r.bank_balance_minor)}
          {line("+ إيداعات في الدفاتر لم تظهر في البنك", r.outstanding_in_minor)}
          {line("− دفعات وشيكات لم تُصرف بعد", r.outstanding_out_minor)}
          {line("الرصيد المعدّل حسب البنك", rec.adjustedBank, true)}
        </div>
        <div>
          {line("رصيد حساب البنك في الدفاتر", r.book_balance_minor)}
          {line("+ إيداعات في البنك غير مسجلة", r.unrecorded_in_minor)}
          {line("− خصومات في البنك غير مسجلة", r.unrecorded_out_minor)}
          {line("الرصيد المعدّل حسب الدفاتر", rec.adjustedBook, true)}
        </div>
      </section>
      <p className={`mt-3 rounded border px-3 py-2 text-center font-bold ${r.difference_minor === 0 ? "border-success" : "border-danger"}`}>
        الفرق: <span className="num">{jod(r.difference_minor)}</span> {r.difference_minor === 0 ? "— الحساب متطابق" : "— الحساب غير متطابق"}
      </p>

      {list("حركات في الدفاتر لم تظهر في كشف البنك", book, "لا يوجد.")}
      {list("حركات في كشف البنك غير مسجلة في الدفاتر", bank, "لا يوجد.")}

      <footer className="mt-10 grid grid-cols-3 gap-6 text-center">
        <div>
          <p className="border-t border-text pt-1">أعدّه</p>
        </div>
        <div>
          <p className="border-t border-text pt-1">راجعه</p>
        </div>
        <div>
          <p className="border-t border-text pt-1">اعتمده</p>
        </div>
      </footer>
      <p className="mt-6 text-[10px] text-muted">
        {st.status === "closed" ? `أُغلق الكشف في ${formatDateTime(st.closed_at)} · ` : "الكشف قيد المطابقة · "}
        طُبع بواسطة {profile.full_name || profile.email} في {formatDateTime(new Date().toISOString())}
      </p>
    </main>
  );
}
