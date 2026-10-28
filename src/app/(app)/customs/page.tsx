import type { Metadata } from "next";
import Link from "next/link";
import { Paperclip } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { addDays, todayIso } from "@/lib/date-range";
import { formatDate, formatInt } from "@/lib/format";
import { deleteCustomsDocument, saveCustomsDocument } from "./actions";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { CustomsDocumentForm, CustomsPortalButton, DeleteCustomsButton } from "@/components/customs-forms";

export const metadata: Metadata = { title: "البيانات الجمركية" };

type SearchParams = Promise<{ q?: string; trip?: string; declaration?: string; saved?: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD = "rounded-lg border border-border bg-surface px-3 py-2 text-sm";

type TripRef = { trip_no: number; client_ref: string | null; start_date: string; truck: { code: string } | null; client: { name: string } | null } | null;

const tripLabel = (t: NonNullable<TripRef>) =>
  [t.client_ref ?? `#${t.trip_no}`, t.truck?.code, t.client?.name, formatDate(t.start_date)].filter(Boolean).join(" · ");

/**
 * Customs declarations on file. The inquiry system opens in the user's own
 * browser (the broker's account is never stored here); the declaration is
 * saved as PDF or photo and attached here, on a load or on its own.
 */
export default async function CustomsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(...STAFF_ROLES);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 40);
  const supabase = await createClient();
  const today = todayIso();

  let docsQuery = supabase
    .from("customs_documents")
    .select("id, declaration_no, declaration_date, notes, created_at, trip_id, trip:trips(trip_no, client_ref, start_date, truck:trucks(code), client:clients(name))")
    .order("created_at", { ascending: false })
    .limit(200);
  if (q) docsQuery = docsQuery.ilike("declaration_no", `%${q.replace(/[%_]/g, "")}%`);
  const [settingsRes, docsRes, tripsRes, expensesRes] = await Promise.all([
    supabase.from("company_settings").select("customs_portal_url").maybeSingle(),
    docsQuery,
    supabase
      .from("trips")
      .select("id, trip_no, client_ref, start_date, truck:trucks(code), client:clients(name)")
      .neq("status", "cancelled")
      .gte("start_date", addDays(today, -120))
      .order("start_date", { ascending: false })
      .limit(300),
    // Declarations typed on expenses: the ones with no file yet are listed to attach.
    supabase
      .from("expenses")
      .select("id, expense_date, customs_declaration_no, description, truck:trucks(code)")
      .not("customs_declaration_no", "is", null)
      .gte("expense_date", addDays(today, -180))
      .order("expense_date", { ascending: false })
      .limit(200),
  ]);
  const portal = settingsRes.data?.customs_portal_url ?? "https://www.customs.gov.jo";
  const docs = docsRes.data ?? [];
  const prefillTrip = sp.trip && UUID.test(sp.trip) ? sp.trip : undefined;
  const tripRows = tripsRes.data ?? [];
  const expenses = (expensesRes.data ?? []).filter((e) => e.customs_declaration_no && (!q || e.customs_declaration_no.toLowerCase().includes(q.toLowerCase())));
  const typedNos = [...new Set(expenses.map((e) => e.customs_declaration_no as string))];
  const [filedRes, olderTripRes] = await Promise.all([
    // Which of those declarations already have a file, however old.
    typedNos.length ? supabase.from("customs_documents").select("declaration_no").in("declaration_no", typedNos) : Promise.resolve({ data: [] }),
    // Attaching from an older load's page keeps that load picked.
    prefillTrip && !tripRows.some((t) => t.id === prefillTrip)
      ? supabase.from("trips").select("id, trip_no, client_ref, start_date, truck:trucks(code), client:clients(name)").eq("id", prefillTrip).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const trips = [...(olderTripRes.data ? [olderTripRes.data] : []), ...tripRows].map((t) => ({ id: t.id, label: tripLabel(t as unknown as NonNullable<TripRef>) }));
  const filed = new Set((filedRes.data ?? []).map((d) => d.declaration_no));
  const missing = expenses.filter((e) => !filed.has(e.customs_declaration_no as string));

  return (
    <>
      <PageHeader
        title="البيانات الجمركية"
        subtitle="افتح نظام الاستفسار الجمركي بحساب المخلص من متصفحك، ثم احفظ البيان PDF وأرفقه هنا"
        action={<CustomsPortalButton url={portal} declarationNo={q || sp.declaration} />}
      />
      <div className="flex flex-col gap-5">
        {sp.saved ? (
          <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
            تم حفظ البيان.
          </p>
        ) : null}

        <Card>
          <CardHeader title="إرفاق بيان جمركي" subtitle="يُحفظ الملف بشكل خاص؛ يفتحه الموظفون فقط" />
          <CardBody>
            <CustomsDocumentForm action={saveCustomsDocument} trips={trips} today={today} initial={{ declaration_no: sp.declaration, trip_id: prefillTrip }} />
          </CardBody>
        </Card>

        <form action="/customs" className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1 text-xs text-muted">
            رقم البيان
            <input name="q" defaultValue={q} className={FIELD} dir="ltr" />
          </label>
          <button type="submit" className={buttonClass("secondary")}>
            بحث
          </button>
        </form>

        <Card>
          <CardHeader title="البيانات المحفوظة" subtitle={`${formatInt(docs.length)} بيان`} />
          {docs.length === 0 ? (
            <EmptyState>لا توجد بيانات محفوظة{q ? " بهذا الرقم" : ""}.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>رقم البيان</Th>
                  <Th>التاريخ</Th>
                  <Th>النقلة</Th>
                  <Th>ملاحظات</Th>
                  <Th>الملف</Th>
                  <Th>
                    <span className="sr-only">إجراءات</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const t = d.trip as unknown as TripRef;
                  return (
                    <Tr key={d.id}>
                      <Td className="num whitespace-nowrap font-semibold">
                        <span dir="ltr">{d.declaration_no}</span>
                      </Td>
                      <Td className="num whitespace-nowrap">{formatDate(d.declaration_date)}</Td>
                      <Td className="whitespace-nowrap">
                        {t && d.trip_id ? (
                          <Link href={`/trips/${d.trip_id}`} className="hover:underline">
                            {tripLabel(t)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td className="text-xs">{d.notes ?? ""}</Td>
                      <Td className="whitespace-nowrap">
                        <a href={`/files/customs/${d.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                          <Paperclip className="size-4" aria-hidden />
                          فتح / طباعة
                        </a>
                      </Td>
                      <Td className="whitespace-nowrap">
                        <span className="me-3">
                          <CustomsPortalButton url={portal} declarationNo={d.declaration_no} compact />
                        </span>
                        <DeleteCustomsButton action={deleteCustomsDocument.bind(null, d.id)} />
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        {missing.length ? (
          <Card>
            <CardHeader title="بيانات مسجلة على المصاريف بلا ملف" subtitle="آخر 6 أشهر؛ أرفق ملف كل بيان" />
            <Table>
              <thead>
                <tr>
                  <Th>رقم البيان</Th>
                  <Th>تاريخ المصروف</Th>
                  <Th>الشاحنة</Th>
                  <Th>البيان</Th>
                  <Th>
                    <span className="sr-only">إجراءات</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {missing.map((e) => (
                  <Tr key={e.id}>
                    <Td className="num whitespace-nowrap">
                      <span dir="ltr">{e.customs_declaration_no}</span>
                    </Td>
                    <Td className="num whitespace-nowrap">{formatDate(e.expense_date)}</Td>
                    <Td className="num whitespace-nowrap">{(e.truck as { code: string } | null)?.code ?? "عام"}</Td>
                    <Td>{e.description}</Td>
                    <Td className="whitespace-nowrap">
                      <Link href={`/customs?declaration=${encodeURIComponent(e.customs_declaration_no ?? "")}`} className="text-xs text-primary hover:underline">
                        إرفاق الملف
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : null}
      </div>
    </>
  );
}
