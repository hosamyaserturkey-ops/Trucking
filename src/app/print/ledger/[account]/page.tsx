import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { statementFilter } from "@/lib/ledger";
import { loadStatement } from "@/lib/ledger-data";
import { formatDate, formatDateTime } from "@/lib/format";
import { PrintButton } from "@/components/print-button";
import { Amount, Balance } from "@/components/ledger-bits";

export const metadata: Metadata = { title: "كشف حساب" };

type Params = Promise<{ account: string }>;
type SearchParams = Promise<{ from?: string; to?: string; truck?: string; supplier?: string; driver?: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CELL = "border border-border px-2 py-1";

// A4 landscape account statement, to print or save as PDF.
export default async function StatementPrintPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const profile = await requireRole(...FINANCE_ROLES);
  const { account } = await params;
  if (account !== "expenses" && !UUID.test(account)) notFound();
  const f = statementFilter(await searchParams);
  const supabase = await createClient();
  const [st, settingsRes, truckRes, supplierRes, driverRes] = await Promise.all([
    loadStatement(account, f),
    supabase.from("company_settings").select("company_name").maybeSingle(),
    f.truck ? supabase.from("trucks").select("code").eq("id", f.truck).maybeSingle() : Promise.resolve({ data: null }),
    f.supplier ? supabase.from("suppliers").select("name").eq("id", f.supplier).maybeSingle() : Promise.resolve({ data: null }),
    f.driver ? supabase.from("drivers").select("full_name").eq("id", f.driver).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!st) notFound();
  const party = [truckRes.data?.code, supplierRes.data?.name, driverRes.data?.full_name].filter(Boolean).join(" · ");

  return (
    <main className="mx-auto max-w-[297mm] bg-surface p-6 text-[11px] leading-relaxed print:max-w-none print:p-0">
      <style>{`@page { size: A4 landscape; margin: 10mm; } @media print { thead { display: table-header-group; } tr { break-inside: avoid; } }`}</style>
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton />
      </div>

      <header className="flex items-start justify-between gap-4 border-b-2 border-text pb-3">
        <div>
          <p className="text-lg font-bold">{settingsRes.data?.company_name ?? "شركة النقل"}</p>
          <h1 className="text-xl font-bold">كشف حساب: {st.title}</h1>
          {party ? <p className="text-sm">{party}</p> : null}
        </div>
        <div className="text-start text-sm">
          <p>
            الفترة: من <span className="num">{formatDate(f.from)}</span> إلى <span className="num">{formatDate(f.to)}</span>
          </p>
          <p>المبالغ بالدينار الأردني</p>
        </div>
      </header>

      {st.truncated ? <p className="mt-2 font-bold">تنبيه: الكشف مقطوع بعد {st.lines.length} حركة؛ اطبع فترة أقصر.</p> : null}

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="bg-surface-2">
            <th className={`${CELL} text-start`}>التاريخ</th>
            <th className={`${CELL} text-start`}>القيد</th>
            <th className={`${CELL} text-start`}>البيان</th>
            {st.multiAccount ? <th className={`${CELL} text-start`}>الحساب</th> : null}
            <th className={`${CELL} text-start`}>الشاحنة / الطرف</th>
            <th className={`${CELL} text-start`}>البيان الجمركي</th>
            <th className={`${CELL} text-start`}>سند الصرف</th>
            <th className={`${CELL} text-start`}>الإشعار</th>
            <th className={`${CELL} text-start`}>ملاحظات</th>
            <th className={`${CELL} text-end`}>مدين</th>
            <th className={`${CELL} text-end`}>دائن</th>
            <th className={`${CELL} text-end`}>الرصيد</th>
          </tr>
        </thead>
        <tbody>
          <tr className="font-bold">
            <td className={`${CELL} num`}>{formatDate(f.from)}</td>
            <td className={CELL} />
            <td className={CELL}>رصيد أول المدة</td>
            <td className={CELL} colSpan={st.multiAccount ? 8 : 7} />
            <td className={`${CELL} text-end`}>
              <Balance minor={st.opening} />
            </td>
          </tr>
          {st.lines.map((l) => (
            <tr key={l.id}>
              <td className={`${CELL} num whitespace-nowrap`}>{formatDate(l.entry_date)}</td>
              <td className={`${CELL} num`}>{l.entry_no}</td>
              <td className={CELL}>
                {l.description}
                {l.status === "reversed" ? " (معكوس)" : ""}
              </td>
              {st.multiAccount ? <td className={`${CELL} whitespace-nowrap`}>{l.account}</td> : null}
              <td className={`${CELL} whitespace-nowrap`}>{l.party ?? ""}</td>
              <td className={`${CELL} num`}>
                <span dir="ltr">{l.customs_declaration_no ?? ""}</span>
              </td>
              <td className={`${CELL} num`}>
                <span dir="ltr">{l.voucher_no ?? ""}</span>
              </td>
              <td className={`${CELL} num`}>
                <span dir="ltr">{l.notice_no ?? ""}</span>
              </td>
              <td className={CELL}>{l.notes ?? ""}</td>
              <td className={`${CELL} num whitespace-nowrap text-end`}>
                <Amount minor={l.debit_minor} />
              </td>
              <td className={`${CELL} num whitespace-nowrap text-end`}>
                <Amount minor={l.credit_minor} />
              </td>
              <td className={`${CELL} text-end`}>
                <Balance minor={l.balance_minor} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-surface-2 font-bold">
            <td className={CELL} colSpan={st.multiAccount ? 9 : 8}>
              المجموع والرصيد في {formatDate(f.to)}
            </td>
            <td className={`${CELL} num whitespace-nowrap text-end`}>
              <Amount minor={st.debit} />
            </td>
            <td className={`${CELL} num whitespace-nowrap text-end`}>
              <Amount minor={st.credit} />
            </td>
            <td className={`${CELL} text-end`}>
              <Balance minor={st.closing} />
            </td>
          </tr>
        </tfoot>
      </table>

      <footer className="mt-10 grid grid-cols-2 gap-10 text-sm">
        <p className="border-t border-text pt-2">أعدّه: {profile.full_name || "—"}</p>
        <p className="border-t border-text pt-2">اعتمده:</p>
      </footer>
      <p className="mt-4 text-[10px] text-muted">طُبع في {formatDateTime(new Date().toISOString())}</p>
    </main>
  );
}
