import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { previewImport, runImport } from "./actions";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { ImportForm } from "@/components/import-form";

export const metadata: Metadata = { title: "استيراد من Excel" };

/** Trucks, drivers, customers and suppliers from a filled Excel template, with their opening balances. */
export default async function ImportPage() {
  await requireRole(...FINANCE_ROLES);
  return (
    <>
      <PageHeader title="استيراد من Excel" subtitle="أدخل الشاحنات والسائقين والعملاء والموردين دفعة واحدة من ملف Excel" />
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="الخطوات" />
          <CardBody>
            <ol className="flex list-decimal flex-col gap-1.5 ps-5 text-sm">
              <li>اختر ما تستورده ونزّل قالبه. الأعمدة المعلّمة بـ * مطلوبة، وصف «مثال» يُتجاهل.</li>
              <li>
                عبّئ صفاً لكل سجل. التواريخ بصيغة 2027-03-31 أو 31/03/2027. الرصيد الافتتاحي موجب على الجهة المعتادة (على الزبون، للمورد)،
                وسالب للجهة الأخرى.
              </li>
              <li>ارفع الملف: يُفحص كل صف وتظهر الأخطاء برقم الصف قبل حفظ أي شيء.</li>
              <li>
                اضغط «استيراد». السجل الموجود مسبقاً (بنفس الرقم أو الاسم) لا يتغير؛ يُضاف رصيده الافتتاحي فقط إن لم يكن له رصيد.
              </li>
            </ol>
            <p className="mt-3 text-xs text-muted">
              الأرصدة الافتتاحية تحتاج تاريخ بدء العمل؛ حدده وأدخل أرصدة الصندوق والبنك والشيكات من{" "}
              <Link href="/opening" className="text-primary hover:underline">
                صفحة الأرصدة الافتتاحية
              </Link>
              . استورد الشاحنات قبل السائقين لتُربط الشاحنة المعتادة.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <ImportForm preview={previewImport} run={runImport} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
