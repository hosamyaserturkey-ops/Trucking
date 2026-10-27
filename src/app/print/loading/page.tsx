import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { loadSheetRows, sheetFilter } from "@/lib/loading-data";
import { sheetTotals } from "@/lib/loading-sheet";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, formatDecimal, formatInt } from "@/lib/format";
import { PrintButton } from "@/components/print-button";

export const metadata: Metadata = { title: "كشف التحميل" };

const CELL = "border border-border px-2 py-1";

type SearchParams = Promise<{ date?: string; from?: string; to?: string; truck?: string; client?: string }>;

// A4 landscape loading sheet for a day or a period, to print or save as PDF.
export default async function LoadingSheetPrintPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireRole(...STAFF_ROLES);
  const f = sheetFilter(await searchParams);
  const oneDay = f.from === f.to;
  const supabase = await createClient();
  const [rows, settingsRes, truckRes, clientRes] = await Promise.all([
    loadSheetRows(f),
    supabase.from("company_settings").select("company_name").maybeSingle(),
    f.truck ? supabase.from("trucks").select("code, plate_number").eq("id", f.truck).maybeSingle() : Promise.resolve({ data: null }),
    f.client ? supabase.from("clients").select("name").eq("id", f.client).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const totals = sheetTotals(rows.map((r) => ({ cargo_weight_tons: r.tons, freight_base_minor: r.freightBaseMinor })));

  return (
    <main className="mx-auto max-w-[297mm] bg-surface p-6 text-[12px] leading-relaxed print:max-w-none print:p-0">
      <style>{`@page { size: A4 landscape; margin: 10mm; } @media print { thead { display: table-header-group; } tr { break-inside: avoid; } }`}</style>
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton />
      </div>

      <header className="flex items-start justify-between gap-4 border-b-2 border-text pb-3">
        <div>
          <p className="text-lg font-bold">{settingsRes.data?.company_name ?? "شركة النقل"}</p>
          <h1 className="text-xl font-bold">كشف التحميل {oneDay ? "اليومي" : ""}</h1>
        </div>
        <div className="text-start text-sm">
          <p>
            {oneDay ? (
              <>
                التاريخ: <span className="num font-bold">{formatDate(f.from)}</span>
              </>
            ) : (
              <>
                الفترة: من <span className="num">{formatDate(f.from)}</span> إلى <span className="num">{formatDate(f.to)}</span>
              </>
            )}
          </p>
          {truckRes.data ? (
            <p>
              الشاحنة: <span className="num">{truckRes.data.code}</span> · <span className="num">{truckRes.data.plate_number}</span>
            </p>
          ) : null}
          {clientRes.data ? <p>الزبون: {clientRes.data.name}</p> : null}
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="mt-6 text-muted">لا توجد نقلات.</p>
      ) : (
        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr className="bg-surface-2">
              <th className={`${CELL} text-start`}>#</th>
              <th className={`${CELL} text-start`}>رقم الإشارة</th>
              {oneDay ? null : <th className={`${CELL} text-start`}>التاريخ</th>}
              <th className={`${CELL} text-start`}>الشاحنة</th>
              <th className={`${CELL} text-start`}>السائق</th>
              <th className={`${CELL} text-start`}>الزبون</th>
              <th className={`${CELL} text-start`}>من</th>
              <th className={`${CELL} text-start`}>إلى</th>
              <th className={`${CELL} text-start`}>الحمولة</th>
              <th className={`${CELL} text-end`}>الوزن (طن)</th>
              <th className={`${CELL} text-end`}>الأجرة</th>
              <th className={`${CELL} text-start`}>مستند الزبون</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className={`${CELL} num`}>{i + 1}</td>
                <td className={`${CELL} num whitespace-nowrap`}>
                  <span dir="ltr">{r.ref ?? "—"}</span>
                </td>
                {oneDay ? null : <td className={`${CELL} num whitespace-nowrap`}>{formatDate(r.date)}</td>}
                <td className={`${CELL} num whitespace-nowrap`}>{r.truckCode}</td>
                <td className={`${CELL} whitespace-nowrap`}>{r.driver ?? "—"}</td>
                <td className={CELL}>{r.client ?? "—"}</td>
                <td className={CELL}>{r.from ?? "—"}</td>
                <td className={CELL}>{r.to ?? "—"}</td>
                <td className={CELL}>{r.cargo ?? "—"}</td>
                <td className={`${CELL} num text-end`}>{r.tons === null ? "—" : formatDecimal(r.tons)}</td>
                <td className={`${CELL} num text-end whitespace-nowrap`}>{formatMoney(r.freightMinor, r.currency)}</td>
                <td className={`${CELL} num`}>
                  <span dir="ltr">{r.docNo ?? ""}</span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-surface-2 font-bold">
              <td className={CELL} colSpan={oneDay ? 2 : 3}>
                المجموع: <span className="num">{formatInt(totals.loads)}</span> نقلة
              </td>
              <td className={CELL} colSpan={6} />
              <td className={`${CELL} num text-end`}>{formatDecimal(totals.tons)}</td>
              <td className={`${CELL} num text-end whitespace-nowrap`}>{formatMoney(totals.freightBaseMinor, "JOD")}</td>
              <td className={CELL} />
            </tr>
          </tfoot>
        </table>
      )}

      <footer className="mt-10 grid grid-cols-2 gap-10 text-sm">
        <p className="border-t border-text pt-2">أعدّه: {profile.full_name || "—"}</p>
        <p className="border-t border-text pt-2">اعتمده:</p>
      </footer>
      <p className="mt-4 text-[10px] text-muted">طُبع في {formatDateTime(new Date().toISOString())}</p>
    </main>
  );
}
