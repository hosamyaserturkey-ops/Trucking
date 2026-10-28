"use client";

import { useActionState, useState } from "react";
import type { InvoiceFormState } from "@/app/(app)/invoices/actions";
import { invoiceTotals } from "@/lib/invoicing";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/form";

type Action = (prev: InvoiceFormState, formData: FormData) => Promise<InvoiceFormState>;

export type DraftLoad = {
  id: string;
  date: string;
  ref: string | null;
  docNo: string | null;
  truck: string;
  route: string;
  cargo: string | null;
  tons: number | null;
  amountMinor: number; // JOD
  original: string | null; // the freight in USD, when it was
};

const CELL = "border-b border-border px-3 py-2";

/** Tick the loads to invoice; subtotal, tax and total follow the ticks. */
export function InvoiceDraftForm({
  action,
  clientId,
  loads,
  vatRatePct,
  today,
}: {
  action: Action;
  clientId: string;
  loads: DraftLoad[];
  vatRatePct: number;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [picked, setPicked] = useState<Set<string>>(() => new Set(loads.map((l) => l.id)));
  const chosen = loads.filter((l) => picked.has(l.id));
  const t = invoiceTotals(chosen.map((l) => l.amountMinor), vatRatePct);
  const lastDate = chosen.reduce((m, l) => (l.date > m ? l.date : m), "");
  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="client_id" value={clientId} />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-surface-2 text-xs text-muted">
              <th className={`${CELL} w-10 text-start`}>
                <input
                  type="checkbox"
                  aria-label="تحديد الكل"
                  checked={picked.size === loads.length}
                  onChange={(e) => setPicked(e.target.checked ? new Set(loads.map((l) => l.id)) : new Set())}
                  className="size-4"
                />
              </th>
              <th className={`${CELL} text-start font-semibold`}>التاريخ</th>
              <th className={`${CELL} text-start font-semibold`}>رقم الإشارة</th>
              <th className={`${CELL} text-start font-semibold`}>الشاحنة</th>
              <th className={`${CELL} text-start font-semibold`}>المسار</th>
              <th className={`${CELL} text-start font-semibold`}>الحمولة</th>
              <th className={`${CELL} text-start font-semibold`}>مستند الزبون</th>
              <th className={`${CELL} text-end font-semibold`}>الأجرة (د.أ)</th>
            </tr>
          </thead>
          <tbody>
            {loads.map((l) => (
              <tr key={l.id} className={picked.has(l.id) ? "" : "text-muted"}>
                <td className={CELL}>
                  <input
                    type="checkbox"
                    name="trip_id"
                    value={l.id}
                    checked={picked.has(l.id)}
                    onChange={() => toggle(l.id)}
                    aria-label={`تحديد ${l.ref ?? l.date}`}
                    className="size-4"
                  />
                </td>
                <td className={`${CELL} num whitespace-nowrap`}>{l.date.split("-").reverse().join("/")}</td>
                <td className={`${CELL} num whitespace-nowrap`}>
                  <span dir="ltr">{l.ref ?? "—"}</span>
                </td>
                <td className={`${CELL} num whitespace-nowrap`}>{l.truck}</td>
                <td className={`${CELL} whitespace-nowrap`}>{l.route}</td>
                <td className={CELL}>
                  {l.cargo ?? "—"}
                  {l.tons !== null ? <span className="num text-muted"> · {l.tons} طن</span> : null}
                </td>
                <td className={`${CELL} num whitespace-nowrap`}>
                  <span dir="ltr">{l.docNo ?? ""}</span>
                </td>
                <td className={`${CELL} num whitespace-nowrap text-end`}>
                  {formatMoney(l.amountMinor, "JOD", { withCurrency: false })}
                  {l.original ? <span className="block text-xs text-muted">{l.original}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="تاريخ الفاتورة" htmlFor="invoice_date" hint={lastDate ? `لا يسبق تاريخ آخر نقلة مختارة (${lastDate})` : undefined}>
            <Input id="invoice_date" name="invoice_date" type="date" dir="ltr" min={lastDate || undefined} max={today} defaultValue={today} />
          </Field>
          <Field label="ملاحظات على الفاتورة" htmlFor="notes">
            <Input id="notes" name="notes" />
          </Field>
        </div>
        <dl className="grid min-w-64 grid-cols-[auto_1fr] gap-x-6 gap-y-1 rounded-lg bg-surface-2 p-3 text-sm" aria-live="polite">
          <dt className="text-muted">عدد النقلات</dt>
          <dd className="num text-end">{chosen.length}</dd>
          <dt className="text-muted">المجموع قبل الضريبة</dt>
          <dd className="num text-end">{formatMoney(t.subtotal, "JOD")}</dd>
          <dt className="text-muted">ضريبة المبيعات ({vatRatePct}%)</dt>
          <dd className="num text-end">{formatMoney(t.vat, "JOD")}</dd>
          <dt className="font-semibold">الإجمالي</dt>
          <dd className="num text-end text-base font-bold">{formatMoney(t.total, "JOD")}</dd>
        </dl>
      </div>
      <FormError message={state.error} />
      <div>
        <Button type="submit" disabled={pending || chosen.length === 0}>
          {pending ? "جارٍ الإصدار…" : "إصدار الفاتورة"}
        </Button>
      </div>
    </form>
  );
}

/** Cancel an issued invoice, with the reason. */
export function CancelInvoiceForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [open, setOpen] = useState(false);
  if (state.done) return <p role="status" className="text-sm text-muted">تم إلغاء الفاتورة.</p>;
  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        إلغاء الفاتورة
      </Button>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Field label="سبب الإلغاء" htmlFor="reason" hint="تُعكس قيود الفاتورة، وتعود نقلاتها جاهزة للفوترة من جديد.">
        <Input id="reason" name="reason" required />
      </Field>
      <FormError message={state.error} />
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" className="text-danger" disabled={pending}>
          {pending ? "جارٍ الإلغاء…" : "تأكيد الإلغاء"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          تراجع
        </Button>
      </div>
    </form>
  );
}
