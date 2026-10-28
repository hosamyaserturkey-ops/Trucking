import { FileText } from "lucide-react";
import { formatDate } from "@/lib/format";
import { ReceiptInput } from "@/components/receipt-input";
import { Field, Input } from "@/components/ui/form";

function AttachedFile({ href, label }: { href: string; label: string }) {
  // Opens through /files/…: RLS decides, and each view gets a fresh short-lived link.
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex w-fit items-center gap-1 text-sm text-primary hover:underline">
      <FileText className="size-4" aria-hidden />
      {label}
    </a>
  );
}

/** The driving licence scan on the driver form; its number and expiry are fields above. */
export function DriverLicenceSection({ fileHref }: { fileHref: string | null }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div>
        <h3 className="text-sm font-semibold">رخصة القيادة</h3>
        <p className="text-xs text-muted">رقم الرخصة وتاريخ انتهائها في الحقول أعلاه. أرفق صورة الرخصة أو ملف PDF (حتى 10 ميغابايت).</p>
      </div>
      {fileHref ? <AttachedFile href={fileHref} label="عرض الرخصة المرفقة" /> : null}
      <ReceiptInput label={fileHref ? "استبدال صورة الرخصة" : "صورة رخصة القيادة"} document />
    </section>
  );
}

/**
 * The truck licence (رخصة المركبة) on the truck form: number, expiry and scan,
 * kept as the truck's registration document. Only roles that may file truck
 * documents can change it; others see it.
 */
export function TruckLicenceSection({
  number,
  expiry,
  fileHref,
  canAttach,
}: {
  number: string | null;
  expiry: string | null;
  fileHref: string | null;
  canAttach: boolean;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div>
        <h3 className="text-sm font-semibold">رخصة الشاحنة (رخصة المركبة)</h3>
        <p className="text-xs text-muted">تظهر في وثائق الشاحنة، ويصل التنبيه قبل انتهائها بـ 60 و30 و7 أيام.</p>
      </div>
      {canAttach ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="رقم رخصة الشاحنة" htmlFor="licence_number">
            <Input id="licence_number" name="licence_number" dir="ltr" defaultValue={number ?? ""} />
          </Field>
          <Field label="تاريخ انتهاء الرخصة" htmlFor="licence_expiry">
            <Input id="licence_expiry" name="licence_expiry" type="date" dir="ltr" defaultValue={expiry ?? ""} />
          </Field>
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:w-fit">
          <dt className="text-muted">رقم الرخصة</dt>
          <dd className="num">{number ?? "—"}</dd>
          <dt className="text-muted">تنتهي في</dt>
          <dd className="num">{formatDate(expiry)}</dd>
        </dl>
      )}
      {fileHref ? <AttachedFile href={fileHref} label="عرض الرخصة المرفقة" /> : null}
      {canAttach ? <ReceiptInput label={fileHref ? "استبدال صورة الرخصة" : "صورة رخصة الشاحنة"} document /> : null}
    </section>
  );
}
