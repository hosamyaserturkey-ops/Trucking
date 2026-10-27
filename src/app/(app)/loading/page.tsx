import Link from "next/link";
import type { Metadata } from "next";
import { Printer } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { canSeeFinancials, STAFF_ROLES, TRIP_WRITERS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { loadTripOptions } from "@/lib/trip-options";
import { loadSheetRows, sheetFilter } from "@/lib/loading-data";
import { sheetTotals } from "@/lib/loading-sheet";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDecimal, formatInt } from "@/lib/format";
import { saveLoad, deleteLoad } from "./actions";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { LoadForm } from "@/components/load-form";
import { DeleteLoadButton } from "@/components/delete-load-button";

export const metadata: Metadata = { title: "كشف التحميل اليومي" };

const FOOT = "border-t-2 border-border px-3 py-2";

type SearchParams = Promise<{
  date?: string;
  from?: string;
  to?: string;
  truck?: string;
  client?: string;
  saved?: string;
  deleted?: string;
  error?: string;
}>;

export default async function LoadingSheetPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireRole(...STAFF_ROLES);
  const canWrite = TRIP_WRITERS.includes(profile.role);
  const finance = canSeeFinancials(profile.role);
  const sp = await searchParams;
  const f = sheetFilter(sp);
  const oneDay = f.from === f.to;
  const today = todayIso();

  const supabase = await createClient();
  const [rows, options, trucksRes, clientsRes] = await Promise.all([
    loadSheetRows(f),
    canWrite ? loadTripOptions() : Promise.resolve(null),
    supabase.from("trucks").select("id, code").order("code"),
    supabase.from("clients").select("id, name").order("name"),
  ]);
  const totals = sheetTotals(rows.map((r) => ({ cargo_weight_tons: r.tons, freight_base_minor: r.freightBaseMinor })));
  const printQuery = new URLSearchParams(
    Object.entries({ from: f.from, to: f.to, truck: f.truck, client: f.client }).filter(([, v]) => v),
  );
  const select = "rounded-lg border border-border bg-surface px-3 py-2 text-sm";

  return (
    <>
      <PageHeader
        title="كشف التحميل اليومي"
        subtitle={oneDay ? formatDate(f.from) : `من ${formatDate(f.from)} إلى ${formatDate(f.to)}`}
        action={
          <Link href={`/print/loading?${printQuery}`} target="_blank" className={buttonClass("secondary")}>
            <Printer className="size-4" aria-hidden />
            طباعة الكشف
          </Link>
        }
      />

      <form action="/loading" className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1 text-xs text-muted">
          اليوم
          <input type="date" name="date" defaultValue={oneDay ? f.from : ""} max={today} className={select} dir="ltr" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          الشاحنة
          <select name="truck" defaultValue={f.truck} className={select}>
            <option value="">الكل</option>
            {(trucksRes.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.code}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          الزبون
          <select name="client" defaultValue={f.client} className={select}>
            <option value="">الكل</option>
            {(clientsRes.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClass("secondary")}>
          عرض
        </button>
        <details className="text-xs text-muted">
          <summary className="cursor-pointer py-2">فترة بدل يوم واحد</summary>
          <div className="mt-1 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              من
              <input type="date" name="from" defaultValue={oneDay ? "" : f.from} className={select} dir="ltr" />
            </label>
            <label className="flex flex-col gap-1">
              إلى
              <input type="date" name="to" defaultValue={oneDay ? "" : f.to} className={select} dir="ltr" />
            </label>
          </div>
        </details>
      </form>

      <div className="flex flex-col gap-5">
        {sp.saved ? (
          <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
            تم حفظ النقلة{sp.saved !== "1" ? <> · رقم الإشارة <span className="num font-bold" dir="ltr">{sp.saved}</span></> : null}
          </p>
        ) : null}
        {sp.deleted ? (
          <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
            تم حذف النقلة.
          </p>
        ) : null}
        {sp.error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {sp.error}
          </p>
        ) : null}

        {options ? (
          <Card>
            <CardHeader title="نقلة جديدة" subtitle="سطر لكل نقلة؛ رقم الإشارة يُعطى تلقائياً عند الحفظ" />
            <CardBody>
              <LoadForm
                key={sp.saved ?? "new"}
                options={options}
                today={today}
                initial={{ load_date: f.to > today ? today : f.to }}
                action={saveLoad.bind(null, null)}
                submitLabel="حفظ النقلة"
              />
            </CardBody>
          </Card>
        ) : null}

        <StatGrid>
          <Stat label="عدد النقلات" value={formatInt(totals.loads)} />
          <Stat label="الأطنان" value={formatDecimal(totals.tons)} />
          <Stat label="الأجرة (دينار)" value={formatMoney(totals.freightBaseMinor, "JOD", { fractionDigits: 0 })} />
          <Stat label="الشاحنات" value={formatInt(new Set(rows.map((r) => r.truckCode)).size)} />
        </StatGrid>

        <Card>
          <CardHeader title="النقلات" subtitle={finance ? "الأجرة تُحسب ضمن إيراد الشاحنة" : undefined} />
          {rows.length === 0 ? (
            <EmptyState>لا توجد نقلات {oneDay ? "في هذا اليوم" : "في هذه الفترة"}.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>رقم الإشارة</Th>
                  {oneDay ? null : <Th>التاريخ</Th>}
                  <Th>الشاحنة</Th>
                  <Th>السائق</Th>
                  <Th>الزبون</Th>
                  <Th>من</Th>
                  <Th>إلى</Th>
                  <Th>الحمولة</Th>
                  <Th className="text-end">الوزن</Th>
                  <Th className="text-end">الأجرة</Th>
                  <Th>مستند الزبون</Th>
                  {canWrite ? (
                    <Th>
                      <span className="sr-only">إجراءات</span>
                    </Th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td className="num whitespace-nowrap font-medium">
                      <span dir="ltr">{r.ref ?? "—"}</span>
                    </Td>
                    {oneDay ? null : <Td className="num whitespace-nowrap">{formatDate(r.date)}</Td>}
                    <Td className="num whitespace-nowrap">{r.truckCode}</Td>
                    <Td className="whitespace-nowrap">{r.driver ?? "—"}</Td>
                    <Td className="whitespace-nowrap">{r.client ?? "—"}</Td>
                    <Td className="whitespace-nowrap">{r.from ?? "—"}</Td>
                    <Td className="whitespace-nowrap">{r.to ?? "—"}</Td>
                    <Td>{r.cargo ?? "—"}</Td>
                    <Td className="num text-end whitespace-nowrap">{r.tons === null ? "—" : formatDecimal(r.tons)}</Td>
                    <Td className="num text-end whitespace-nowrap">{formatMoney(r.freightMinor, r.currency)}</Td>
                    <Td className="num whitespace-nowrap">
                      <span dir="ltr">{r.docNo ?? "—"}</span>
                    </Td>
                    {canWrite ? (
                      <Td className="whitespace-nowrap">
                        <Link href={`/loading/${r.id}/edit`} className="me-3 text-xs text-primary hover:underline">
                          تعديل
                        </Link>
                        <DeleteLoadButton action={deleteLoad.bind(null, r.id, f.to)} label={r.ref ?? ""} />
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <td className={FOOT}>المجموع</td>
                  <td className={`${FOOT} num`} colSpan={oneDay ? 6 : 7}>
                    {formatInt(totals.loads)} نقلة
                  </td>
                  <td className={`${FOOT} num text-end whitespace-nowrap`}>{formatDecimal(totals.tons)}</td>
                  <td className={`${FOOT} num text-end whitespace-nowrap`}>{formatMoney(totals.freightBaseMinor, "JOD")}</td>
                  <td className={FOOT} colSpan={canWrite ? 2 : 1} />
                </tr>
              </tfoot>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
