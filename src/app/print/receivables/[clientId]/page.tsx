import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { statementFilter } from "@/lib/ledger";
import { loadClientStatement } from "@/lib/receivables-data";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { PrintButton } from "@/components/print-button";
import { Amount, Balance } from "@/components/ledger-bits";

export const metadata: Metadata = { title: "كشف حساب زبون" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CELL = "border border-border px-2 py-1";

// A4 customer statement, to print or send to the customer as PDF.
export default async function ClientStatementPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const profile = await requireRole(...FINANCE_ROLES);
  const { clientId } = await params;
  if (!UUID.test(clientId)) notFound();
  const sp = await searchParams;
  const f = statementFilter(sp.from && sp.to ? sp : { from: `${todayIso().slice(0, 4)}-01-01`, to: todayIso() });
  const supabase = await createClient();
  const [st, settingsRes] = await Promise.all([
    loadClientStatement(clientId, f),
    supabase.from("company_settings").select("company_name, tax_number, address, phone").maybeSingle(),
  ]);
  if (!st) notFound();
  const company = settingsRes.data;

  return (
    <main className="mx-auto max-w-[210mm] bg-surface p-6 text-[12px] leading-relaxed print:max-w-none print:p-0">
      <style>{`@page { size: A4; margin: 12mm; } @media print { thead { display: table-header-group; } tr { break-inside: avoid; } }`}</style>
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton />
      </div>
      <header className="flex items-start justify-between gap-4 border-b-2 border-text pb-3">
        <div>
          <p className="text-lg font-bold">{company?.company_name ?? "شركة النقل"}</p>
          {company?.address ? <p>{company.address}</p> : null}
          {company?.phone ? (
            <p>
              هاتف: <span dir="ltr">{company.phone}</span>
            </p>
          ) : null}
        </div>
        <div className="text-start">
          <h1 className="text-xl font-bold">كشف حساب عميل</h1>
          <p className="font-bold">{st.client.name}</p>
          <p>
            من <span className="num">{formatDate(f.from)}</span> إلى <span className="num">{formatDate(f.to)}</span>
          </p>
        </div>
      </header>

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="bg-surface-2">
            <th className={`${CELL} text-start`}>التاريخ</th>
            <th className={`${CELL} text-start`}>البيان</th>
            <th className={`${CELL} text-start`}>التفاصيل</th>
            <th className={`${CELL} text-end`}>مدين</th>
            <th className={`${CELL} text-end`}>دائن</th>
            <th className={`${CELL} text-end`}>الرصيد</th>
          </tr>
        </thead>
        <tbody>
          <tr className="font-bold">
            <td className={`${CELL} num`}>{formatDate(f.from)}</td>
            <td className={CELL}>رصيد أول المدة</td>
            <td className={CELL} colSpan={3} />
            <td className={`${CELL} text-end`}>
              <Balance minor={st.opening} />
            </td>
          </tr>
          {st.lines.map((l) => (
            <tr key={l.key}>
              <td className={`${CELL} num whitespace-nowrap`}>{formatDate(l.date)}</td>
              <td className={CELL}>{l.description}</td>
              <td className={CELL}>{l.details ?? ""}</td>
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
            <td className={CELL} colSpan={3}>
              الرصيد المستحق في {formatDate(f.to)}
            </td>
            <td className={`${CELL} num text-end`}>
              <Amount minor={st.debit} />
            </td>
            <td className={`${CELL} num text-end`}>
              <Amount minor={st.credit} />
            </td>
            <td className={`${CELL} text-end`}>
              <Balance minor={st.closing} />
            </td>
          </tr>
        </tfoot>
      </table>
      {st.balance?.cheques_pending_minor ? (
        <p className="mt-2">
          منها شيكات برسم التحصيل: <span className="num">{formatMoney(st.balance.cheques_pending_minor, "JOD")}</span>
        </p>
      ) : null}

      <footer className="mt-12 grid grid-cols-2 gap-10 text-sm">
        <p className="border-t border-text pt-2">المحاسب: {profile.full_name || ""}</p>
        <p className="border-t border-text pt-2">مصادقة العميل على الرصيد:</p>
      </footer>
      <p className="mt-4 text-[10px] text-muted">طُبع في {formatDateTime(new Date().toISOString())}</p>
    </main>
  );
}
