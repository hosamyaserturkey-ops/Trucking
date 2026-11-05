import type { Metadata } from "next";
import { Truck } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "تسجيل الدخول" };

/**
 * Sign-in: the form on the right (RTL) and a photo of a truck on a desert
 * road filling the rest on wide screens; on phones the photo is a strip
 * above the form.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
      <div className="flex flex-1 items-center justify-center px-4 pb-10 pt-6 lg:py-10">
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
      </div>

      <div className="relative order-first h-44 overflow-hidden sm:h-60 lg:order-none lg:h-auto" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP files; no image optimiser on Cloudflare */}
        <img
          src="/photos/truck-1600.webp"
          srcSet="/photos/truck-800.webp 800w, /photos/truck-1600.webp 1600w"
          sizes="(min-width: 1024px) 58vw, 100vw"
          width={1600}
          height={906}
          alt=""
          fetchPriority="high"
          className="absolute inset-0 size-full object-cover object-[37%_72%]"
        />
        {/* On phones the strip fades into the page so the form doesn't sit on a hard edge. */}
        <div className="absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-bg to-transparent lg:hidden" />
      </div>
    </main>
  );
}
