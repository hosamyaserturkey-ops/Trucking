import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { truckPage, tripInRange, type TruckPageProps } from "@/lib/truck";
import { inclusiveEnd } from "@/lib/date-range";
import { perUnit, pnlTotals } from "@/lib/pnl";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, formatInt } from "@/lib/format";
import { COST_KINDS, PNL_KIND } from "@/lib/labels";
import { PrintButton } from "@/components/print-button";

export const metadata: Metadata = { title: "كشف الشاحنة" };

// A4 statement for one truck. Rendered by the browser, so Arabic shaping and
// right-to-left order come out right in "Save as PDF" and in headless PDF export.
export default async function TruckStatementPage(props: TruckPageProps) {
  const profile = await requireRole(...FINANCE_ROLES);
  const { id, truck, range } = await truckPage(props);
  const supabase = await createClient();

  const [settingsRes, pnlRes, tripsRes] = await Promise.all([
    supabase.from("company_settings").select("company_name").maybeSingle(),
    supabase.rpc("truck_pnl_summary", { p_from: range.from, p_to: range.to, p_truck_id: id }),
    supabase
      .from("trip_profit_v")
      .select("trip_id, trip_no, start_date, from_name, to_name, client_name, is_empty_return, distance_km, freight_base_minor, fuel_base_minor, expenses_base_minor, profit_base_minor")
      .eq("truck_id", id)
      .in("status", ["in_progress", "completed"])
      .or(tripInRange(range))
      .order("start_date"),
  ]);
  const pnl = pnlTotals(pnlRes.data ?? []);
  const trips = tripsRes.data ?? [];
  const km = trips.reduce((s, t) => s + Math.max(t.distance_km ?? 0, 0), 0);

  return (
    <main className="mx-auto max-w-[210mm] bg-surface p-6 text-[13px] leading-relaxed print:max-w-none print:p-0">
      <style>{`@page { size: A4; margin: 14mm 12mm; } @media print { thead { display: table-header-group; } tr { break-inside: avoid; } }`}</style>

      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton />
      </div>

      <header className="flex items-start justify-between gap-4 border-b-2 border-text pb-3">
        <div>
          <p className="text-lg font-bold">{settingsRes.data?.company_name ?? "شركة النقل"}</p>
          <h1 className="text-xl font-bold">كشف حساب الشاحنة</h1>
        </div>
        <div className="text-start text-sm">
          <p>
            الشاحنة: <span className="num font-bold">{truck.code}</span> · اللوحة: <span className="num">{truck.plate_number}</span>
          </p>
          <p>{[truck.make, truck.model, truck.year].filter(Boolean).join(" ")}</p>
          <p>
            الفترة: من <span className="num">{formatDate(range.from)}</span> إلى{" "}
            <span className="num">{formatDate(inclusiveEnd(range))}</span>
          </p>
        </div>
      </header>

      <section className="mt-5">
        <h2 className="mb-2 font-bold">ملخص الأرباح والخسائر (دينار أردني)</h2>
        <table className="w-full border-collapse">
          <tbody>
            <tr className="font-bold">
              <td className="border border-border px-3 py-1.5">{PNL_KIND.revenue}</td>
              <td className="num border border-border px-3 py-1.5 text-end">{formatMoney(pnl.revenue, "JOD", { withCurrency: false })}</td>
            </tr>
            {COST_KINDS.map((k) => (
              <tr key={k}>
                <td className="border border-border px-3 py-1.5 ps-6">{PNL_KIND[k]}</td>
                <td className="num border border-border px-3 py-1.5 text-end">
                  ({formatMoney(pnl.byKind[k] ?? 0, "JOD", { withCurrency: false })})
                </td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className="border border-border px-3 py-1.5">إجمالي التكاليف</td>
              <td className="num border border-border px-3 py-1.5 text-end">({formatMoney(pnl.costs, "JOD", { withCurrency: false })})</td>
            </tr>
            <tr className="bg-surface-2 font-bold">
              <td className="border border-border px-3 py-1.5">صافي الربح</td>
              <td className="num border border-border px-3 py-1.5 text-end">{formatMoney(pnl.profit, "JOD", { withCurrency: false })}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-sm">
          عدد الرحلات: <span className="num">{formatInt(trips.length)}</span> · المسافة: <span className="num">{formatInt(km)}</span> كم ·
          التكلفة لكل كم: <span className="num">{formatMoney(perUnit(pnl.costs, km))}</span>
        </p>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 font-bold">تفاصيل الرحلات</h2>
        {trips.length === 0 ? (
          <p className="text-muted">لا توجد رحلات في هذه الفترة.</p>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-surface-2">
                <th className="border border-border px-2 py-1 text-start">رقم</th>
                <th className="border border-border px-2 py-1 text-start">التاريخ</th>
                <th className="border border-border px-2 py-1 text-start">المسار</th>
                <th className="border border-border px-2 py-1 text-start">العميل</th>
                <th className="border border-border px-2 py-1 text-end">كم</th>
                <th className="border border-border px-2 py-1 text-end">الأجرة</th>
                <th className="border border-border px-2 py-1 text-end">الديزل</th>
                <th className="border border-border px-2 py-1 text-end">مصاريف</th>
                <th className="border border-border px-2 py-1 text-end">الربح</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((t) => (
                <tr key={t.trip_id}>
                  <td className="num border border-border px-2 py-1">{t.trip_no}</td>
                  <td className="num border border-border px-2 py-1 whitespace-nowrap">{formatDate(t.start_date)}</td>
                  <td className="border border-border px-2 py-1 whitespace-nowrap">
                    {t.from_name} ← {t.to_name}
                  </td>
                  <td className="border border-border px-2 py-1">{t.is_empty_return ? "عودة فارغة" : t.client_name}</td>
                  <td className="num border border-border px-2 py-1 text-end">{formatInt(t.distance_km)}</td>
                  <td className="num border border-border px-2 py-1 text-end">{formatMoney(t.freight_base_minor, "JOD", { withCurrency: false })}</td>
                  <td className="num border border-border px-2 py-1 text-end">{formatMoney(t.fuel_base_minor, "JOD", { withCurrency: false })}</td>
                  <td className="num border border-border px-2 py-1 text-end">{formatMoney(t.expenses_base_minor, "JOD", { withCurrency: false })}</td>
                  <td className="num border border-border px-2 py-1 text-end">{formatMoney(t.profit_base_minor, "JOD", { withCurrency: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer className="mt-6 border-t border-border pt-2 text-xs text-muted">
        أُعد بواسطة {profile.full_name || profile.email} · <span className="num">{formatDateTime(new Date().toISOString())}</span> (بتوقيت عمّان)
      </footer>
    </main>
  );
}
