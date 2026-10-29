import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { JOURNAL_SOURCE, sourceHref, sourceLabel, statementFilter } from "@/lib/ledger";
import { existingSources } from "@/lib/ledger-data";
import { formatDate, formatInt } from "@/lib/format";
import { JOURNAL_STATUS } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { Amount } from "@/components/ledger-bits";

export const metadata: Metadata = { title: "دفتر اليومية" };

type SearchParams = Promise<{ from?: string; to?: string; source?: string; entry?: string; page?: string }>;

const PAGE = 50;
const FIELD = "rounded-lg border border-border bg-surface px-3 py-2 text-sm";
const CELL = "border-b border-border px-3 py-1.5";

type Line = {
  line_no: number;
  debit_minor: number;
  credit_minor: number;
  account: { code: string; name_ar: string } | null;
  truck: { code: string } | null;
  supplier: { name: string } | null;
  driver: { full_name: string } | null;
  client: { name: string } | null;
};

/** Every journal entry with its lines, newest first; one entry by its number. */
export default async function JournalPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(...FINANCE_ROLES);
  const sp = await searchParams;
  const f = statementFilter(sp);
  const entryNo = /^\d{1,12}$/.test(sp.entry ?? "") ? Number(sp.entry) : null;
  const source = sp.source && (sp.source === "manual" || JOURNAL_SOURCE[sp.source]) ? sp.source : "";
  const page = Math.max(1, Number(sp.page) || 1);

  const supabase = await createClient();
  let q = supabase
    .from("journal_entries")
    .select(
      "id, entry_no, entry_date, description, status, source_type, source_id, reverses_entry_id, lines:journal_lines(line_no, debit_minor, credit_minor, account:accounts(code, name_ar), truck:trucks(code), supplier:suppliers(name), driver:drivers(full_name), client:clients(name))",
      { count: "exact" },
    )
    .neq("status", "draft")
    .order("entry_date", { ascending: false })
    .order("entry_no", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (entryNo !== null) q = q.eq("entry_no", entryNo);
  else {
    q = q.gte("entry_date", f.from).lte("entry_date", f.to);
    if (source === "manual") q = q.is("source_type", null);
    else if (source) q = q.eq("source_type", source);
  }
  const { data, count } = await q;
  const entries = data ?? [];
  const existing = await existingSources(entries);
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (p: number) => {
    const u = new URLSearchParams({ from: f.from, to: f.to });
    if (source) u.set("source", source);
    u.set("page", String(p));
    return `/journal?${u}`;
  };

  return (
    <>
      <PageHeader
        title="دفتر اليومية"
        subtitle={entryNo !== null ? `القيد رقم ${entryNo}` : `${formatInt(total)} قيد من ${formatDate(f.from)} إلى ${formatDate(f.to)}`}
        action={
          <Link href={`/ledger?from=${f.from}&to=${f.to}`} className={buttonClass("secondary")}>
            كشف الحسابات
          </Link>
        }
      />
      <form action="/journal" className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1 text-xs text-muted">
          من
          <input type="date" name="from" defaultValue={f.from} className={FIELD} dir="ltr" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          إلى
          <input type="date" name="to" defaultValue={f.to} className={FIELD} dir="ltr" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          المصدر
          <select name="source" defaultValue={source} className={FIELD}>
            <option value="">الكل</option>
            {Object.entries(JOURNAL_SOURCE).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
            <option value="manual">قيد يدوي</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          رقم القيد
          <input name="entry" inputMode="numeric" defaultValue={entryNo ?? ""} className={`${FIELD} w-28`} dir="ltr" />
        </label>
        <button type="submit" className={buttonClass("secondary")}>
          عرض
        </button>
      </form>

      {entries.length === 0 ? (
        <Card>
          <EmptyState>لا توجد قيود.</EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map((e) => {
            const st = JOURNAL_STATUS[e.status];
            const deleted = !!sourceHref(e.source_type, e.source_id) && !existing.has(e.source_id ?? "");
            const href = deleted ? null : sourceHref(e.source_type, e.source_id);
            const lines = [...((e.lines ?? []) as unknown as Line[])].sort((a, b) => a.line_no - b.line_no);
            return (
              <Card key={e.id}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5 text-sm">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="num font-bold">قيد {e.entry_no}</span>
                    <span className="num text-muted">{formatDate(e.entry_date)}</span>
                    {href ? (
                      <Link href={href} className="text-primary hover:underline">
                        {e.description}
                      </Link>
                    ) : (
                      <span>
                        {e.description}
                        {deleted ? <span className="ms-1 text-xs text-muted">(المستند محذوف)</span> : null}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge>{sourceLabel(e.source_type)}</Badge>
                    {e.reverses_entry_id ? <Badge tone="info">قيد عكسي</Badge> : null}
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm" data-entry={e.entry_no}>
                    <thead>
                      <tr className="text-xs text-muted">
                        <th className={`${CELL} text-start font-medium`}>الحساب</th>
                        <th className={`${CELL} text-start font-medium`}>الشاحنة / الطرف</th>
                        <th className={`${CELL} text-end font-medium`}>مدين</th>
                        <th className={`${CELL} text-end font-medium`}>دائن</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l.line_no}>
                          <td className={`${CELL} whitespace-nowrap ${l.credit_minor ? "ps-8" : ""}`}>
                            <span className="num text-muted">{l.account?.code}</span> {l.account?.name_ar}
                          </td>
                          <td className={`${CELL} whitespace-nowrap`}>
                            {[l.truck?.code, l.supplier?.name, l.driver?.full_name, l.client?.name].filter(Boolean).join(" · ") || "—"}
                          </td>
                          <td className={`${CELL} num whitespace-nowrap text-end`}>
                            <Amount minor={l.debit_minor} />
                          </td>
                          <td className={`${CELL} num whitespace-nowrap text-end`}>
                            <Amount minor={l.credit_minor} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
          {pages > 1 && entryNo === null ? (
            <nav className="flex items-center justify-center gap-2 text-sm" aria-label="الصفحات">
              {page > 1 ? (
                <Link href={link(page - 1)} className={buttonClass("secondary", "py-1.5")}>
                  الأحدث
                </Link>
              ) : null}
              <span className="num text-muted">
                صفحة {page} من {pages}
              </span>
              {page < pages ? (
                <Link href={link(page + 1)} className={buttonClass("secondary", "py-1.5")}>
                  الأقدم
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      )}
    </>
  );
}
