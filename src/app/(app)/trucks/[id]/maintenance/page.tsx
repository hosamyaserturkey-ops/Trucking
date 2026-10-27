import { requireRole } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { truckPage, type TruckPageProps } from "@/lib/truck";
import { formatMoney, sumMinor } from "@/lib/money";
import { formatDate, formatDecimal, formatInt } from "@/lib/format";
import { SERVICE_STATUS, TIRE_POSITIONS, WORK_ORDER_KIND, WORK_ORDER_STATUS } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";

type Installation = {
  id: string;
  position_code: string;
  installed_on: string;
  installed_odometer: number;
  removed_on: string | null;
  removed_odometer: number | null;
  removal_reason: string | null;
  km_run: number | null;
  tire: { serial_no: string; brand: string | null; size: string | null; retread_count: number } | null;
};

export default async function TruckMaintenancePage(props: TruckPageProps) {
  await requireRole(...STAFF_ROLES);
  const { id, truck, range } = await truckPage(props);
  const supabase = await createClient();

  const [servicesRes, ordersRes, tiresRes] = await Promise.all([
    supabase.from("service_due_v").select("*").eq("truck_id", id).order("service_name"),
    supabase
      .from("work_orders")
      .select(
        "id, wo_no, kind, status, opened_on, closed_on, odometer, description, invoice_no, currency, total_minor, total_base_minor, workshop:suppliers(name), work_order_lines(id, line_type, description, quantity, unit_price_minor, line_total_minor)",
      )
      .eq("truck_id", id)
      .or(`status.eq.open,and(opened_on.gte.${range.from},opened_on.lt.${range.to})`)
      .order("opened_on", { ascending: false }),
    supabase
      .from("tire_installations")
      .select(
        "id, position_code, installed_on, installed_odometer, removed_on, removed_odometer, removal_reason, km_run, tire:tires(serial_no, brand, size, retread_count)",
      )
      .eq("truck_id", id)
      .order("installed_on", { ascending: false }),
  ]);

  const services = servicesRes.data ?? [];
  const orders = ordersRes.data ?? [];
  const installs = (tiresRes.data ?? []) as Installation[];
  const current = new Map(installs.filter((i) => !i.removed_on).map((i) => [i.position_code, i]));
  const history = installs.filter((i) => i.removed_on);
  const total = sumMinor(orders.filter((o) => o.status !== "cancelled").map((o) => o.total_base_minor));

  return (
    <>
      <Card>
        <CardHeader title="الصيانة الدورية" subtitle="حسب الكيلومترات و/أو التاريخ" />
        {services.length === 0 ? (
          <EmptyState>لا توجد جداول صيانة لهذه الشاحنة.</EmptyState>
        ) : (
          <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {services.map((s) => {
              const st = SERVICE_STATUS[s.due_status ?? "ok"];
              return (
                <li key={s.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{s.service_name}</p>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    {s.interval_km ? (
                      <>
                        <dt className="text-muted">كل</dt>
                        <dd className="num">{formatInt(s.interval_km)} كم</dd>
                        <dt className="text-muted">آخر مرة عند</dt>
                        <dd className="num">{formatInt(s.last_done_odometer)} كم</dd>
                        <dt className="text-muted">المتبقي</dt>
                        <dd className={`num font-semibold ${(s.km_left ?? 0) < 0 ? "text-danger" : ""}`}>
                          {formatInt(s.km_left)} كم
                        </dd>
                      </>
                    ) : null}
                    {s.interval_days ? (
                      <>
                        <dt className="text-muted">موعد التاريخ</dt>
                        <dd className="num">{formatDate(s.next_due_on)}</dd>
                      </>
                    ) : null}
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="أوامر الصيانة وفواتير الورش"
          subtitle={`${formatInt(orders.length)} أمر · ${formatMoney(total)} · ${range.label} (والمفتوحة دائماً)`}
        />
        {orders.length === 0 ? (
          <EmptyState>لا توجد أوامر صيانة في هذه الفترة.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {orders.map((o) => {
              const st = WORK_ORDER_STATUS[o.status];
              const workshop = (o.workshop as { name: string } | null)?.name;
              return (
                <li key={o.id}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0">
                        <span className="font-medium">{o.description}</span>
                        <span className="block text-xs text-muted">
                          <span className="num">#{o.wo_no}</span> · {WORK_ORDER_KIND[o.kind]} · {workshop ?? "—"} ·{" "}
                          <span className="num">{formatDate(o.opened_on)}</span>
                          {o.odometer ? (
                            <>
                              {" "}
                              · <span className="num">{formatInt(o.odometer)}</span> كم
                            </>
                          ) : null}
                          {o.invoice_no ? (
                            <>
                              {" "}
                              · فاتورة <span className="num">{o.invoice_no}</span>
                            </>
                          ) : null}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="num font-semibold">{formatMoney(o.total_minor, o.currency)}</span>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </span>
                    </summary>
                    <div className="px-4 pb-3">
                      <Table className="rounded-lg border border-border">
                        <thead>
                          <tr>
                            <Th>البند</Th>
                            <Th className="text-end">الكمية</Th>
                            <Th className="text-end">سعر الوحدة</Th>
                            <Th className="text-end">المجموع</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {o.work_order_lines.map((l) => (
                            <tr key={l.id}>
                              <Td>
                                {l.description}
                                <span className="ms-2 text-xs text-muted">
                                  {l.line_type === "labor" ? "أجور" : l.line_type === "part" ? "قطع" : ""}
                                </span>
                              </Td>
                              <Td className="num text-end">{formatDecimal(l.quantity, 0)}</Td>
                              <Td className="num text-end">{formatMoney(l.unit_price_minor, o.currency, { withCurrency: false })}</Td>
                              <Td className="num text-end">{formatMoney(l.line_total_minor, o.currency, { withCurrency: false })}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="الإطارات حسب الموقع"
          subtitle="منظر علوي، مقدمة الشاحنة في الأعلى. F أمامي، D1 وD2 محورا الدفع، L/R يسار/يمين، O/I خارجي/داخلي."
        />
        <CardBody>
          <TireMap current={current} odometer={truck.odometer} />
        </CardBody>
        {history.length > 0 ? (
          <>
            <h3 className="border-t border-border px-4 pt-4 text-sm font-semibold">إطارات مستبدلة</h3>
            <Table>
              <thead>
                <tr>
                  <Th>الرقم التسلسلي</Th>
                  <Th>الموقع</Th>
                  <Th>التركيب</Th>
                  <Th>الإزالة</Th>
                  <Th className="text-end">كم مقطوعة</Th>
                  <Th>السبب</Th>
                </tr>
              </thead>
              <tbody>
                {history.map((i) => (
                  <Tr key={i.id}>
                    <Td className="num">{i.tire?.serial_no}</Td>
                    <Td>{TIRE_POSITIONS.find((p) => p.code === i.position_code)?.label ?? i.position_code}</Td>
                    <Td className="num">{formatDate(i.installed_on)}</Td>
                    <Td className="num">{formatDate(i.removed_on)}</Td>
                    <Td className="num text-end">{formatInt(i.km_run)}</Td>
                    <Td>{i.removal_reason ?? "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </>
        ) : null}
      </Card>
    </>
  );
}

const AXLES: { label: string; left: string[]; right: string[] }[] = [
  { label: "المحور الأمامي", left: ["F-L"], right: ["F-R"] },
  { label: "محور الدفع 1", left: ["D1-LO", "D1-LI"], right: ["D1-RI", "D1-RO"] },
  { label: "محور الدفع 2", left: ["D2-LO", "D2-LI"], right: ["D2-RI", "D2-RO"] },
];

function TireMap({ current, odometer }: { current: Map<string, Installation>; odometer: number | null }) {
  const cell = (code: string) => {
    const inst = current.get(code);
    const label = TIRE_POSITIONS.find((p) => p.code === code)?.label ?? code;
    const km = inst && odometer ? odometer - inst.installed_odometer : null;
    return (
      <div
        key={code}
        dir="rtl"
        className={`min-w-0 flex-1 rounded-lg border p-1.5 text-[11px] leading-snug sm:p-2 sm:text-xs ${
          inst ? "border-border bg-surface-2" : "border-dashed border-danger text-danger"
        }`}
        title={`${label}${inst ? ` · ${inst.tire?.serial_no} · ${inst.tire?.brand ?? ""}` : ""}`}
      >
        <p className="num font-semibold">{code}</p>
        <p className="hidden font-medium sm:block">{label}</p>
        {inst ? (
          <>
            <p className="num mt-0.5 hidden break-all text-muted sm:block">{inst.tire?.serial_no}</p>
            <p className="hidden text-muted sm:block">
              {inst.tire?.brand}
              {inst.tire?.retread_count ? ` · مجدد ${inst.tire.retread_count}` : ""}
            </p>
            <p className="mt-0.5">
              <span className="num">{formatInt(km)}</span> كم
            </p>
          </>
        ) : (
          <p className="mt-0.5">فارغ</p>
        )}
      </div>
    );
  };

  // Physical left/right, so the grid itself is laid out left-to-right.
  return (
    <div dir="ltr" className="mx-auto flex max-w-2xl flex-col gap-4">
      {AXLES.map((axle) => (
        <div key={axle.label}>
          <p dir="rtl" className="mb-1.5 text-center text-xs font-medium text-muted">
            {axle.label}
          </p>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 sm:gap-2">
            <div className="flex min-w-0 gap-1 sm:gap-2">{axle.left.map(cell)}</div>
            <div className="h-1 w-3 rounded bg-border sm:w-16" aria-hidden />
            <div className="flex min-w-0 gap-1 sm:gap-2">{axle.right.map(cell)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
