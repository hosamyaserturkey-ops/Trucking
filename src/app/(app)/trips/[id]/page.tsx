import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, CornerUpLeft, Pencil } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { canSeeFinancials, STAFF_ROLES, TRIP_WRITERS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/date-range";
import { formatMoney, sumMinor } from "@/lib/money";
import { formatDate, formatDateTime, formatDecimal, formatInt } from "@/lib/format";
import { EXPENSE_STATUS, PAYMENT_METHOD, TRIP_STATUS } from "@/lib/labels";
import { changeTripStatus } from "../actions";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { CancelTripButton, OdometerAction } from "@/components/trip-status-actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `رحلة ${(await params).id.slice(0, 8)}` };
}

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole(...STAFF_ROLES);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const finance = canSeeFinancials(profile.role);
  const canWrite = TRIP_WRITERS.includes(profile.role);
  const supabase = await createClient();

  const [tripRes, rawRes, fuelRes, expensesRes, advancesRes] = await Promise.all([
    supabase.from("trip_profit_v").select("*").eq("trip_id", id).maybeSingle(),
    supabase
      .from("trips")
      .select("start_odometer, end_odometer, cargo_weight_tons, fx_rate, notes, entry_source, client_ref, client_doc_no, truck:trucks(code, plate_number)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("fuel_fillups").select("id, filled_at, odometer, liters, is_full_tank, amount_base_minor").eq("trip_id", id).order("filled_at"),
    supabase
      .from("expenses")
      .select("id, expense_date, description, currency, amount_minor, amount_base_minor, payment_method, status, category:expense_categories(name_ar)")
      .eq("trip_id", id)
      .order("expense_date"),
    supabase.from("driver_advances").select("id, issued_on, currency, amount_minor, method, notes").eq("trip_id", id).order("issued_on"),
  ]);
  const trip = tripRes.data;
  const raw = rawRes.data;
  if (!trip || !raw) notFound();

  const truck = raw.truck as { code: string; plate_number: string } | null;
  const st = TRIP_STATUS[trip.status ?? "planned"];
  const fuel = fuelRes.data ?? [];
  const expenses = expensesRes.data ?? [];
  const advances = advancesRes.data ?? [];
  const today = todayIso();

  const { data: overview } = await supabase.from("truck_overview_v").select("odometer").eq("truck_id", trip.truck_id!).maybeSingle();

  return (
    <>
      <Link href="/trips" className="mb-3 flex w-fit items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronRight className="size-4" aria-hidden />
        الرحلات
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            الرحلة <span className="num">{trip.trip_no}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
            {trip.is_empty_return ? <Badge>عودة فارغة</Badge> : null}
            {raw.entry_source === "sheet" ? <Badge tone="info">كشف التحميل</Badge> : null}
            {raw.client_ref ? (
              <span className="num text-base font-medium text-muted" dir="ltr">
                {raw.client_ref}
              </span>
            ) : null}
          </span>
        }
        subtitle={
          <>
            {trip.from_name} ← {trip.to_name} · الشاحنة{" "}
            <Link href={`/trucks/${trip.truck_id}`} className="num text-primary hover:underline">
              {truck?.code}
            </Link>{" "}
            · {trip.driver_name ?? "بدون سائق"}
          </>
        }
        action={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              {raw.entry_source !== "sheet" && (trip.status === "completed" || trip.status === "in_progress") ? (
                <LinkButton href={`/trips/new?return_of=${id}`}>
                  <CornerUpLeft className="size-4" aria-hidden />
                  رحلة العودة
                </LinkButton>
              ) : null}
              {trip.status !== "cancelled" ? (
                <LinkButton href={raw.entry_source === "sheet" ? `/loading/${id}/edit` : `/trips/${id}/edit`}>
                  <Pencil className="size-4" aria-hidden />
                  تعديل
                </LinkButton>
              ) : null}
            </div>
          ) : null
        }
      />

      <div className="flex flex-col gap-5">
        {canWrite && (trip.status === "planned" || trip.status === "in_progress") ? (
          <Card>
            <CardHeader
              title={trip.status === "planned" ? "بدء الرحلة" : "إنهاء الرحلة"}
              subtitle="يمكن للسائق أيضاً البدء والإنهاء من هاتفه"
            />
            <CardBody className="flex flex-wrap items-start justify-between gap-4">
              {trip.status === "planned" ? (
                <OdometerAction
                  action={changeTripStatus.bind(null, id, "start")}
                  label="بدء الرحلة"
                  defaultOdometer={overview?.odometer}
                  defaultDate={today}
                  odometerHint={overview?.odometer ? `آخر قراءة مسجلة للشاحنة: ${formatInt(overview.odometer)} كم` : undefined}
                />
              ) : (
                <OdometerAction
                  action={changeTripStatus.bind(null, id, "finish")}
                  label="إنهاء الرحلة"
                  defaultDate={today}
                  odometerHint={`قراءة البداية: ${formatInt(raw.start_odometer)} كم`}
                />
              )}
              <CancelTripButton action={changeTripStatus.bind(null, id, "cancel")} />
            </CardBody>
          </Card>
        ) : null}

        <StatGrid>
          <Stat
            label="التاريخ"
            value={formatDate(trip.start_date)}
            hint={trip.end_date ? `الانتهاء ${formatDate(trip.end_date)}` : undefined}
          />
          <Stat
            label="المسافة"
            value={trip.distance_km !== null ? `${formatInt(trip.distance_km)} كم` : "—"}
            hint={`العداد ${formatInt(raw.start_odometer)} ← ${formatInt(raw.end_odometer)}`}
          />
          <Stat
            label="الأجرة"
            value={formatMoney(trip.freight_minor, trip.currency ?? "JOD")}
            hint={trip.currency !== "JOD" ? `${formatMoney(trip.freight_base_minor)} بسعر ${raw.fx_rate}` : undefined}
          />
          {finance ? (
            <Stat
              label="ربح الرحلة"
              value={formatMoney(trip.profit_base_minor)}
              tone={(trip.profit_base_minor ?? 0) >= 0 ? "success" : "danger"}
              hint="الأجرة ناقص الديزل والمصاريف المعتمدة"
            />
          ) : (
            <Stat label="الديزل" value={`${formatDecimal(trip.fuel_liters)} لتر`} />
          )}
        </StatGrid>

        <Card>
          <CardHeader title="تفاصيل" />
          <dl className="grid gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">العميل</dt>
              <dd>{trip.client_name ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">البضاعة</dt>
              <dd>
                {trip.cargo_description ?? "—"}
                {raw.cargo_weight_tons ? <span className="num"> · {raw.cargo_weight_tons} طن</span> : null}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">كم/لتر</dt>
              <dd className="num">{formatDecimal(trip.km_per_liter)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">ملاحظات</dt>
              <dd>{raw.notes ?? "—"}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardHeader
            title="مصاريف الرحلة"
            subtitle={`المعتمدة: ${formatMoney(sumMinor(expenses.filter((e) => e.status === "approved").map((e) => e.amount_base_minor)))}`}
          />
          {expenses.length === 0 ? (
            <EmptyState>لا توجد مصاريف على هذه الرحلة.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>التاريخ</Th>
                  <Th>الفئة</Th>
                  <Th>البيان</Th>
                  <Th>الدفع</Th>
                  <Th className="text-end">المبلغ</Th>
                  <Th>الحالة</Th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => {
                  const es = EXPENSE_STATUS[e.status];
                  return (
                    <Tr key={e.id}>
                      <Td className="num whitespace-nowrap">{formatDate(e.expense_date)}</Td>
                      <Td className="whitespace-nowrap">{(e.category as { name_ar: string } | null)?.name_ar}</Td>
                      <Td>{e.description}</Td>
                      <Td className="whitespace-nowrap">{PAYMENT_METHOD[e.payment_method] ?? e.payment_method}</Td>
                      <Td className="num whitespace-nowrap text-end">{formatMoney(e.amount_minor, e.currency)}</Td>
                      <Td>
                        <Badge tone={es.tone}>{es.label}</Badge>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="الديزل" subtitle={`${formatDecimal(trip.fuel_liters)} لتر · ${formatMoney(trip.fuel_base_minor)}`} />
            {fuel.length === 0 ? (
              <EmptyState>لا توجد تعبئات على هذه الرحلة.</EmptyState>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {fuel.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <span className="num">{formatDateTime(f.filled_at)}</span>
                    <span className="num">
                      {formatDecimal(f.liters)} لتر · {formatMoney(f.amount_base_minor)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="عهد مرتبطة بالرحلة" />
            {advances.length === 0 ? (
              <EmptyState>لا توجد عهد مرتبطة بهذه الرحلة.</EmptyState>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {advances.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <span>
                      <span className="num">{formatDate(a.issued_on)}</span> {a.notes ? `· ${a.notes}` : ""}
                    </span>
                    <span className="num">{formatMoney(a.amount_minor, a.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
