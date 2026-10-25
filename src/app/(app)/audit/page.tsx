import Link from "next/link";
import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatInt } from "@/lib/format";
import { AUDIT_ACTION, AUDIT_TABLE } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import type { Json } from "@/types/database";

export const metadata: Metadata = { title: "سجل التدقيق" };

const PAGE_SIZE = 50;
const IGNORED = new Set(["updated_at", "created_at"]);

function changedFields(oldData: Json | null, newData: Json | null): string[] {
  const o = (oldData ?? {}) as Record<string, unknown>;
  const n = (newData ?? {}) as Record<string, unknown>;
  return Object.keys({ ...o, ...n }).filter((k) => !IGNORED.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k]));
}

function short(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ table?: string; page?: string }> }) {
  await requireRole("manager");
  const sp = await searchParams;
  const table = sp.table && AUDIT_TABLE[sp.table] ? sp.table : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const supabase = await createClient();
  let query = supabase
    .from("audit_log_v")
    .select("*", { count: "exact" })
    .order("at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (table) query = query.eq("table_name", table);
  const { data, count, error } = await query;
  const rows = data ?? [];
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const href = (p: number, t = table) => `/audit?${new URLSearchParams({ ...(t ? { table: t } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader
        title="سجل التدقيق"
        subtitle="كل إضافة وتعديل وحذف في النظام، مع المستخدم والوقت (بتوقيت عمّان). السجل لا يُعدّل ولا يُحذف."
      />
      <form className="mb-4 flex flex-wrap items-center gap-2" action="/audit">
        <label htmlFor="table" className="text-sm text-muted">
          الجدول
        </label>
        <select
          id="table"
          name="table"
          defaultValue={table ?? ""}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        >
          <option value="">الكل</option>
          {Object.entries(AUDIT_TABLE).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonClass("secondary")}>
          عرض
        </button>
      </form>
      <Card>
        {error ? (
          <EmptyState>تعذر تحميل السجل: {error.message}</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>لا توجد أحداث.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>الوقت</Th>
                <Th>المستخدم</Th>
                <Th>الجدول</Th>
                <Th>العملية</Th>
                <Th>التغييرات</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const action = AUDIT_ACTION[r.action ?? "UPDATE"];
                const fields = r.action === "UPDATE" ? changedFields(r.old_data, r.new_data) : [];
                const o = (r.old_data ?? {}) as Record<string, unknown>;
                const n = (r.new_data ?? {}) as Record<string, unknown>;
                return (
                  <Tr key={r.id}>
                    <Td className="num whitespace-nowrap">{formatDateTime(r.at)}</Td>
                    <Td className="whitespace-nowrap">{r.user_name || r.user_email || <span className="text-muted">النظام</span>}</Td>
                    <Td className="whitespace-nowrap">{AUDIT_TABLE[r.table_name ?? ""] ?? r.table_name}</Td>
                    <Td>
                      <Badge tone={action.tone}>{action.label}</Badge>
                    </Td>
                    <Td className="text-xs">
                      {r.action === "UPDATE" ? (
                        <ul className="flex flex-col gap-0.5">
                          {fields.slice(0, 6).map((f) => (
                            <li key={f}>
                              <span className="font-medium">{f}</span>:{" "}
                              <span className="num text-muted line-through">{short(o[f])}</span>{" "}
                              <span className="num">{short(n[f])}</span>
                            </li>
                          ))}
                          {fields.length > 6 ? <li className="text-muted">و{fields.length - 6} حقول أخرى</li> : null}
                        </ul>
                      ) : (
                        <span className="num text-muted">{r.record_id}</span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {pages > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="الصفحات">
          {page > 1 ? (
            <Link href={href(page - 1)} className={buttonClass("secondary")}>
              الأحدث
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            صفحة <span className="num">{formatInt(page)}</span> من <span className="num">{formatInt(pages)}</span>
          </span>
          {page < pages ? (
            <Link href={href(page + 1)} className={buttonClass("secondary")}>
              الأقدم
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  );
}
