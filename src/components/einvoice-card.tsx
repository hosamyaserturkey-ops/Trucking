import Link from "next/link";
import { FileCode } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { loadEinvoiceInput } from "@/lib/einvoice-data";
import { jofotaraConfig } from "@/lib/jofotara";
import { formatDateTime, formatInt } from "@/lib/format";
import { submitEinvoice } from "@/app/(app)/invoices/actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EinvoiceQr } from "@/components/einvoice-qr";
import { SendEinvoiceButton } from "@/components/einvoice-forms";

type Doc = {
  id: string;
  kind: string;
  icv: number;
  doc_no: string;
  status: string;
  attempts: number;
  last_attempt_at: string | null;
  last_error: string | null;
  submitted_at: string | null;
  einv_uuid: string | null;
  einv_num: string | null;
  einv_qr: string | null;
};

const KIND_LABEL: Record<string, string> = { invoice: "الفاتورة", credit_note: "إشعار الإرجاع (فاتورة إرجاع)" };

/** JoFotara status of an invoice and its credit note, with the send buttons. */
export async function EinvoiceCard({ invoiceId, invoiceStatus }: { invoiceId: string; invoiceStatus: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("einvoices")
    .select("id, kind, icv, doc_no, status, attempts, last_attempt_at, last_error, submitted_at, einv_uuid, einv_num, einv_qr")
    .eq("invoice_id", invoiceId)
    .order("icv");
  const docs = (data ?? []) as Doc[];
  const invoiceDoc = docs.find((d) => d.kind === "invoice");
  const creditDoc = docs.find((d) => d.kind === "credit_note");
  const configured = !!jofotaraConfig();
  const needsInvoice = invoiceStatus === "issued" && invoiceDoc?.status !== "submitted";
  const needsCredit = invoiceStatus === "cancelled" && invoiceDoc?.status === "submitted" && creditDoc?.status !== "submitted";
  const pendingKind = needsInvoice ? "invoice" : needsCredit ? "credit_note" : null;
  const check = pendingKind ? await loadEinvoiceInput(supabase, invoiceId, pendingKind, null) : null;

  return (
    <Card>
      <CardHeader
        title="الفوترة الإلكترونية (جوفوترة)"
        subtitle="إرسال الفاتورة إلى نظام الفوترة الوطني لدائرة ضريبة الدخل والمبيعات"
        action={
          <Link href={`/invoices/${invoiceId}/xml${pendingKind === "credit_note" || (!pendingKind && creditDoc) ? "?kind=credit_note" : ""}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            <FileCode className="size-4" aria-hidden />
            ملف XML
          </Link>
        }
      />
      <CardBody className="flex flex-col gap-4">
        {docs.length === 0 && invoiceStatus === "cancelled" ? <p className="text-sm text-muted">أُلغيت الفاتورة قبل إرسالها؛ لا حاجة لإرسالها.</p> : null}
        {docs.map((d) => (
          <div key={d.id} className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border p-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">المستند</dt>
              <dd>
                {KIND_LABEL[d.kind]} <span className="num">{d.doc_no}</span>{" "}
                {d.status === "submitted" ? (
                  <Badge tone="success">مقبولة</Badge>
                ) : d.last_error ? (
                  <Badge tone="danger">مرفوضة</Badge>
                ) : (
                  <Badge tone="warning">لم تُرسل</Badge>
                )}
              </dd>
              <dt className="text-muted">عداد الفواتير (ICV)</dt>
              <dd className="num">{d.icv}</dd>
              <dt className="text-muted">المعرّف (UUID)</dt>
              <dd className="num break-all text-xs" dir="ltr">
                {d.id}
              </dd>
              {d.einv_num ? (
                <>
                  <dt className="text-muted">رقم النظام</dt>
                  <dd className="num" dir="ltr">
                    {d.einv_num}
                  </dd>
                </>
              ) : null}
              {d.submitted_at ? (
                <>
                  <dt className="text-muted">قُبلت في</dt>
                  <dd className="num">{formatDateTime(d.submitted_at)}</dd>
                </>
              ) : d.last_attempt_at ? (
                <>
                  <dt className="text-muted">آخر محاولة</dt>
                  <dd className="num">
                    {formatDateTime(d.last_attempt_at)} · {formatInt(d.attempts)} محاولة
                  </dd>
                </>
              ) : null}
            </dl>
            {d.einv_qr ? <EinvoiceQr text={d.einv_qr} size={110} /> : null}
            {d.status !== "submitted" && d.last_error ? (
              <p className="w-full whitespace-pre-line rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">سبب الرفض: {d.last_error}</p>
            ) : null}
          </div>
        ))}

        {pendingKind ? (
          <>
            {check && check.problems.length ? (
              <div className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
                <p className="font-semibold">قبل الإرسال:</p>
                <ul className="list-disc ps-5">
                  {check.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!configured ? (
              <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
                الربط مع نظام الفوترة غير مفعّل بعد: يضع مدير النظام رمزي الربط (Client ID و Secret Key) من بوابة جوفوترة في إعدادات الخادم. حتى ذلك يمكن تنزيل ملف XML ومراجعته.
              </p>
            ) : (
              <SendEinvoiceButton
                action={submitEinvoice.bind(null, invoiceId, pendingKind)}
                label={pendingKind === "invoice" ? "إرسال الفاتورة إلى جوفوترة" : "إرسال إشعار الإرجاع إلى جوفوترة"}
                confirmText={
                  pendingKind === "invoice"
                    ? "إرسال الفاتورة إلى نظام الفوترة الوطني؟ بعد قبولها لا تُلغى إلا بإشعار إرجاع."
                    : "إرسال إشعار الإرجاع لهذه الفاتورة الملغاة إلى نظام الفوترة الوطني؟"
                }
              />
            )}
          </>
        ) : null}
        {invoiceStatus === "issued" && invoiceDoc?.status === "submitted" ? (
          <p className="text-xs text-muted">إلغاء هذه الفاتورة يُنشئ إشعار إرجاع يجب إرساله إلى النظام.</p>
        ) : null}
      </CardBody>
    </Card>
  );
}
