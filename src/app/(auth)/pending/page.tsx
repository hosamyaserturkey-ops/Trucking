import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { getProfile } from "@/lib/auth";
import { signOut } from "../actions";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "بانتظار الصلاحيات" };

export default async function PendingPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role) redirect("/");

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 text-center">
        <Clock className="mx-auto size-8 text-warning" aria-hidden />
        <h1 className="mt-3 text-lg font-bold">حسابك بانتظار التفعيل</h1>
        <p className="mt-2 text-sm text-muted">
          تم إنشاء حسابك <span className="num">{profile.email}</span>. سيحدد مدير النظام صلاحياتك قريباً.
        </p>
        <form action={signOut} className="mt-5">
          <Button type="submit" variant="secondary" className="w-full">
            تسجيل الخروج
          </Button>
        </form>
      </div>
    </main>
  );
}
