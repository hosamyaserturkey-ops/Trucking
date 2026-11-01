import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveCompany } from "./actions";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { CompanyForm } from "@/components/company-form";
import { jofotaraConfig } from "@/lib/jofotara";

export const metadata: Metadata = { title: "بيانات الشركة" };

/** Company details printed on invoices and receipts, and the sales tax rate. */
export default async function CompanyPage() {
  await requireRole("manager");
  const supabase = await createClient();
  const { data } = await supabase.from("company_settings").select("company_name, tax_number, address, phone, vat_rate_pct, customs_portal_url, jofotara_income_source").maybeSingle();
  return (
    <>
      <PageHeader title="بيانات الشركة" subtitle="تظهر على الفواتير وسندات القبض وكشوف الحساب" />
      <Card>
        <CardBody>
          <CompanyForm
            action={saveCompany}
            initial={{
              company_name: data?.company_name ?? "",
              tax_number: data?.tax_number ?? null,
              address: data?.address ?? null,
              phone: data?.phone ?? null,
              vat_rate_pct: Number(data?.vat_rate_pct ?? 16),
              customs_portal_url: data?.customs_portal_url ?? null,
              jofotara_income_source: data?.jofotara_income_source ?? null,
            }}
            jofotaraLinked={!!jofotaraConfig()}
          />
        </CardBody>
      </Card>
    </>
  );
}
