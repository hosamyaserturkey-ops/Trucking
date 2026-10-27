import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { JOURNAL_STATUS } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Amount } from "@/components/ledger-bits";

type Line = { line_no: number; debit_minor: number; credit_minor: number; account: { code: string; name_ar: string } | null };

const CELL = "border-b border-border px-3 py-1.5";

/** The journal entries behind an expense or fill-up: the current one, and any it replaced. */
export async function JournalEntryCard({ sourceType, sourceId }: { sourceType: string; sourceId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("journal_entries")
    .select("id, entry_no, entry_date, description, status, reverses_entry_id, lines:journal_lines(line_no, debit_minor, credit_minor, account:accounts(code, name_ar))")
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .neq("status", "draft")
    .order("entry_no");
  const entries = data ?? [];

  return (
    <Card>
      <CardHeader title="القيد المحاسبي" subtitle="يُرحّل تلقائياً عند الاعتماد؛ أي تعديل يعكس القيد ويرحّل قيداً جديداً" />
      {entries.length === 0 ? (
        <EmptyState>لا يوجد قيد؛ يُرحّل عند الاعتماد.</EmptyState>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {entries.map((e) => {
            const st = JOURNAL_STATUS[e.status];
            const lines = [...((e.lines ?? []) as unknown as Line[])].sort((a, b) => a.line_no - b.line_no);
            return (
              <div key={e.id} className={e.status === "posted" && !e.reverses_entry_id ? "" : "text-muted"}>
                <p className="flex flex-wrap items-center gap-2 px-4 pt-3 text-sm">
                  <Link href={`/journal?entry=${e.entry_no}`} className="num font-semibold hover:underline">
                    قيد {e.entry_no}
                  </Link>
                  <span className="num">{formatDate(e.entry_date)}</span>
                  <span>{e.description}</span>
                  {e.reverses_entry_id ? <Badge tone="info">قيد عكسي</Badge> : <Badge tone={st.tone}>{st.label}</Badge>}
                </p>
                <div className="overflow-x-auto px-1 pb-2">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-xs text-muted">
                        <th className={`${CELL} text-start font-medium`}>الحساب</th>
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
                          <td className={`${CELL} num text-end`}>
                            <Amount minor={l.debit_minor} />
                          </td>
                          <td className={`${CELL} num text-end`}>
                            <Amount minor={l.credit_minor} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
