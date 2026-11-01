"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toLatinDigits } from "@/lib/money";
import { describeDbError } from "@/lib/master-data-parse";
import { parsePortalUrl } from "@/lib/customs";

export type CompanySaveState = { error: string | null; saved?: boolean };

const schema = z.object({
  company_name: z.string().trim().min(1, "اكتب اسم الشركة").max(120),
  tax_number: z.string().trim().max(30),
  address: z.string().trim().max(200),
  phone: z.string().trim().max(30),
  vat_rate_pct: z
    .string()
    .trim()
    .regex(/^\d{1,2}(\.\d{1,2})?$/, "نسبة الضريبة غير صحيحة")
    .refine((v) => Number(v) <= 50, "نسبة الضريبة غير صحيحة"),
});

/** What invoices print about the company, and the sales tax rate new invoices use. */
export async function saveCompany(_prev: CompanySaveState, formData: FormData): Promise<CompanySaveState> {
  await requireRole("manager");
  const get = (name: string) => toLatinDigits(String(formData.get(name) ?? ""));
  const parsed = schema.safeParse({
    company_name: String(formData.get("company_name") ?? ""),
    tax_number: get("tax_number"),
    address: String(formData.get("address") ?? ""),
    phone: get("phone"),
    vat_rate_pct: get("vat_rate_pct"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  const v = parsed.data;
  const portalRaw = String(formData.get("customs_portal_url") ?? "").trim();
  const customs_portal_url = portalRaw ? parsePortalUrl(portalRaw) : null;
  if (portalRaw && !customs_portal_url) return { error: "رابط نظام الجمارك يجب أن يبدأ بـ https://" };
  const incomeSource = get("jofotara_income_source").replace(/\s+/g, "");
  if (incomeSource && !/^\d{1,20}$/.test(incomeSource)) return { error: "تسلسل مصدر الدخل أرقام فقط" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("company_settings")
    .update({
      company_name: v.company_name,
      tax_number: v.tax_number || null,
      address: v.address || null,
      phone: v.phone || null,
      vat_rate_pct: Number(v.vat_rate_pct),
      customs_portal_url,
      jofotara_income_source: incomeSource || null,
    })
    .eq("id", true);
  if (error) return { error: describeDbError(error) };
  revalidatePath("/", "layout");
  return { error: null, saved: true };
}
