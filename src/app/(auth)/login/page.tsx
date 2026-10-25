import type { Metadata } from "next";
import { Truck } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "تسجيل الدخول" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-on-primary">
            <Truck className="size-6" aria-hidden />
          </span>
          <h1 className="text-xl font-bold">نظام النقل</h1>
          <p className="text-sm text-muted">محاسبة وإدارة أسطول الشاحنات</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
