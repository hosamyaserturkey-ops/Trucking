import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, formatInt } from "@/lib/format";
import { PrintButton } from "@/components/print-button";

export const metadata: Metadata = { title: "سند تسوية عهدة" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHOD: Record<string, string> = { cash: "نقداً", bank: "تحويل بنكي" };
const CELL = "border border-border px-2 py-1";

// A4 slip the driver and the accountant sign when an advance is settled.
export default async function SettlementSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole(...FINANCE_ROLES);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();

  const [settlementRes, settingsRes, advancesRes, expensesRes] = await Promise.all([
    supabase
      .from("driver_settlements")
      .select("id, settlement_no, settled_on, advances_base_minor, expenses_base_minor, difference_base_minor, advances_count, expenses_count, notes, created_at, driver:drivers(full_name, national_id, phone)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("company_settings").select("company_name").maybeSingle(),
    supabase
      .from("driver_advances")
      .select("id, issued_on, currency, amount_minor, fx_rate, amount_base_minor, method, notes, trip:trips(trip_no)")
      .eq("settlement_id", id)
      .order("issued_on"),
    supabase
      .from("expenses")
      .select("id, expense_date, currency, amount_minor, fx_rate, amount_base_minor, description, category:expense_categories(name_ar), trip:trips(trip_no), truck:trucks(code)")
      .eq("settlement_id", id)
      .order("expense_date"),
  ]);
  const s = settlementRes.data;
  if (!s) notFound();
  const driver = s.driver as { full_name: string; national_id: string | null; phone: string | null } | null;
  const advances = advancesRes.data ?? [];
  const expenses = expensesRes.data ?? [];
  const diff = s.difference_base_minor;
  const jod = (minor: number) => formatMoney(minor, "JOD", { withCurrency: false });
  const original = (minor: number, currency: string) => (currency === "JOD" ? "—" : formatMoney(minor, currency));

  return (
    <main className="mx-auto max-w-[210mm] bg-surface p-6 text-[13px] leading-relaxed print:max-w-none print:p-0">
      <style>{`@page { size: A4; margin: 14mm 12mm; } @media print { thead { display: table-header-group; } tr { break-inside: avoid; } }`}</style>

      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton />
      </div>

      <header className="flex items-start justify-between gap-4 border-b-2 border-text pb-3">
        <div>
          <p className="text-lg font-bold">{settingsRes.data?.company_name ?? "شركة النقل"}</p>
          <h1 className="text-xl font-bold">سند تسوية عهدة سائق</h1>
        </div>
        <div className="text-start text-sm">
          <p>
            رقم السند: <span className="num font-bold">{s.settlement_no}</span>
          </p>
          <p>
            تاريخ التسوية: <span className="num">{formatDate(s.settled_on)}</span>
          </p>
          <p>
            السائق: <span className="font-bold">{driver?.full_name}</span>
          </p>
          {driver?.national_id ? (
            <p>
              الرقم الوطني: <span className="num">{driver.national_id}</span>
            </p>
          ) : null}
        </div>
      </header>

      <section className="mt-5">
        <h2 className="mb-2 font-bold">العهد المستلمة ({formatInt(advances.length)})</h2>
        {advances.length === 0 ? (
          <p className="text-muted">لا يوجد.</p>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-surface-2">
                <th className={`${CELL} text-start`}>التاريخ</th>
                <th className={`${CELL} text-start`}>البيان</th>
                <th className={`${CELL} text-start`}>الرحلة</th>
                <th className={`${CELL} text-end`}>بالعملة الأصلية</th>
                <th className={`${CELL} text-end`}>بالدينار</th>
              </tr>
            </thead>
            <tbody>
              {advances.map((a) => (
                <tr key={a.id}>
                  <td className={`num ${CELL} whitespace-nowrap`}>{formatDate(a.issued_on)}</td>
                  <td className={CELL}>
                    عهدة {METHOD[a.method] ?? a.method}
                    {a.notes ? ` · ${a.notes}` : ""}
                  </td>
                  <td className={`num ${CELL}`}>{(a.trip as { trip_no: number } | null)?.trip_no ?? "—"}</td>
                  <td className={`num ${CELL} text-end`}>{original(a.amount_minor, a.currency)}</td>
                  <td className={`num ${CELL} text-end`}>{jod(a.amount_base_minor)}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className={CELL} colSpan={4}>
                  مجموع العهد
                </td>
                <td className={`num ${CELL} text-end`}>{jod(s.advances_base_minor)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-5">
        <h2 className="mb-2 font-bold">مصاريف دفعها السائق واعتُمدت ({formatInt(expenses.length)})</h2>
        {expenses.length === 0 ? (
          <p className="text-muted">لا يوجد.</p>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-surface-2">
                <th className={`${CELL} text-start`}>التاريخ</th>
                <th className={`${CELL} text-start`}>النوع والبيان</th>
                <th className={`${CELL} text-start`}>الشاحنة / الرحلة</th>
                <th className={`${CELL} text-end`}>بالعملة الأصلية</th>
                <th className={`${CELL} text-end`}>بالدينار</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => {
                const category = (e.category as { name_ar: string } | null)?.name_ar;
                const trip = (e.trip as { trip_no: number } | null)?.trip_no;
                const truck = (e.truck as { code: string } | null)?.code;
                return (
                  <tr key={e.id}>
                    <td className={`num ${CELL} whitespace-nowrap`}>{formatDate(e.expense_date)}</td>
                    <td className={CELL}>
                      {category}
                      {e.description && e.description !== category ? <span className="text-muted"> · {e.description}</span> : null}
                    </td>
                    <td className={`num ${CELL} whitespace-nowrap`}>
                      {truck ?? "—"}
                      {trip ? ` / ${trip}` : ""}
                    </td>
                    <td className={`num ${CELL} text-end`}>{original(e.amount_minor, e.currency)}</td>
                    <td className={`num ${CELL} text-end`}>{jod(e.amount_base_minor)}</td>
                  </tr>
                );
              })}
              <tr className="font-bold">
                <td className={CELL} colSpan={4}>
                  مجموع المصاريف
                </td>
                <td className={`num ${CELL} text-end`}>{jod(s.expenses_base_minor)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-5">
        <table className="w-full border-collapse">
          <tbody>
            <tr>
              <td className={`${CELL} py-1.5`}>مجموع العهد</td>
              <td className={`num ${CELL} py-1.5 text-end`}>{jod(s.advances_base_minor)}</td>
            </tr>
            <tr>
              <td className={`${CELL} py-1.5`}>ناقص: المصاريف المعتمدة</td>
              <td className={`num ${CELL} py-1.5 text-end`}>({jod(s.expenses_base_minor)})</td>
            </tr>
            <tr className="bg-surface-2 font-bold">
              <td className={`${CELL} py-1.5`}>
                {diff > 0 ? "المبلغ الذي أعاده السائق للشركة" : diff < 0 ? "المبلغ الذي دفعته الشركة للسائق" : "لا يوجد فرق نقدي"}
              </td>
              <td className={`num ${CELL} py-1.5 text-end`}>{jod(Math.abs(diff))} د.أ</td>
            </tr>
          </tbody>
        </table>
        {s.notes ? <p className="mt-2">ملاحظة: {s.notes}</p> : null}
      </section>

      <section className="mt-12 grid grid-cols-3 gap-6 text-center text-sm">
        {["توقيع السائق", "المحاسب", "المدير"].map((label) => (
          <div key={label}>
            <div className="h-14 border-b border-text" />
            <p className="mt-1">{label}</p>
          </div>
        ))}
      </section>

      <footer className="mt-8 border-t border-border pt-2 text-xs text-muted">
        أُعد بواسطة {profile.full_name || profile.email} · <span className="num">{formatDateTime(new Date().toISOString())}</span> (بتوقيت
        عمّان) · سُجلت التسوية <span className="num">{formatDateTime(s.created_at)}</span>
      </footer>
    </main>
  );
}
