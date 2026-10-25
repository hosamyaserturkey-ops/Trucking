import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveUser } from "./actions";
import { UserRowForm } from "./user-row-form";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: "المستخدمون" };

export default async function UsersPage() {
  const me = await requireRole("manager");
  const supabase = await createClient();
  const [{ data: profiles }, { data: drivers }] = await Promise.all([
    supabase.from("profiles").select("user_id, email, full_name, role, driver_id").order("created_at"),
    supabase.from("drivers").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);
  const taken = new Set((profiles ?? []).map((p) => p.driver_id).filter(Boolean));
  const pending = (profiles ?? []).filter((p) => !p.role);

  return (
    <>
      <PageHeader
        title="المستخدمون والصلاحيات"
        subtitle="يُنشأ المستخدم من لوحة Supabase (Authentication ← Add user)، ثم تُحدد صلاحيته هنا."
      />
      <Card>
        <CardHeader
          title="الحسابات"
          subtitle={pending.length ? `${pending.length} بانتظار تحديد الصلاحية` : "مدير: كل شيء · محاسب: المالية والبيانات · منسق حركة: العمليات · سائق: بياناته فقط"}
        />
        {!profiles?.length ? (
          <EmptyState>لا يوجد مستخدمون.</EmptyState>
        ) : (
          profiles.map((p) => (
            <UserRowForm
              key={p.user_id}
              email={p.email}
              fullName={p.full_name}
              role={p.role}
              driverId={p.driver_id}
              drivers={(drivers ?? []).map((d) => ({ ...d, taken: taken.has(d.id) }))}
              action={saveUser.bind(null, p.user_id)}
              isSelf={p.user_id === me.user_id}
            />
          ))
        )}
      </Card>
    </>
  );
}
