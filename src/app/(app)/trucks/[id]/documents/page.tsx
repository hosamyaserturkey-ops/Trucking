import { FileText } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { truckPage, type TruckPageProps } from "@/lib/truck";
import { formatDate, formatInt } from "@/lib/format";
import { DOC_TYPE, EXPIRY_BAND } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";

export default async function TruckDocumentsPage(props: TruckPageProps) {
  await requireRole(...STAFF_ROLES);
  const { id } = await truckPage(props);
  const supabase = await createClient();

  const { data } = await supabase
    .from("document_expiry_v")
    .select("*")
    .eq("truck_id", id)
    .order("expiry_date", { ascending: true, nullsFirst: false });
  const docs = data ?? [];

  return (
    <Card>
      <CardHeader
        title="الوثائق"
        subtitle="الحالة الحالية لكل وثيقة (لا تتأثر بفلتر التاريخ). التنبيه عند 60 و30 و7 أيام."
      />
      {docs.length === 0 ? (
        <EmptyState>لا توجد وثائق لهذه الشاحنة.</EmptyState>
      ) : (
        <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {docs.map((d) => {
            const band = EXPIRY_BAND[d.expiry_band ?? "none"];
            const days = d.days_left;
            // Scans open through /files/…: RLS decides, and each view gets a fresh short-lived link.
            const url = d.file_path && d.id ? `/files/truck-document/${d.id}` : undefined;
            return (
              <li key={d.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{d.title ?? DOC_TYPE[d.doc_type ?? "other"]}</p>
                    <p className="text-xs text-muted">{DOC_TYPE[d.doc_type ?? "other"]}</p>
                  </div>
                  <Badge tone={band.tone}>{band.label}</Badge>
                </div>
                <div className="text-center">
                  {days === null ? (
                    <p className="text-sm text-muted">بدون تاريخ انتهاء</p>
                  ) : days < 0 ? (
                    <p className="text-2xl font-bold text-danger">
                      منتهية منذ <span className="num">{formatInt(-days)}</span> يوم
                    </p>
                  ) : (
                    <p className={`text-2xl font-bold ${band.tone === "danger" ? "text-danger" : band.tone === "warning" ? "text-warning" : ""}`}>
                      <span className="num">{formatInt(days)}</span> يوم متبقي
                    </p>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted">الرقم</dt>
                  <dd className="num">{d.doc_number ?? "—"}</dd>
                  <dt className="text-muted">الجهة</dt>
                  <dd>{d.issuer ?? "—"}</dd>
                  <dt className="text-muted">الإصدار</dt>
                  <dd className="num">{formatDate(d.issue_date)}</dd>
                  <dt className="text-muted">الانتهاء</dt>
                  <dd className="num">{formatDate(d.expiry_date)}</dd>
                </dl>
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm text-primary hover:underline">
                    <FileText className="size-4" aria-hidden />
                    عرض النسخة الممسوحة
                  </a>
                ) : (
                  <p className="text-xs text-muted">لا توجد نسخة ممسوحة بعد</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
