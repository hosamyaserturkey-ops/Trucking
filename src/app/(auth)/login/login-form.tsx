"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "../actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/form";

const initial: SignInState = { error: null };

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="البريد الإلكتروني" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" dir="ltr" required />
      </Field>
      <Field label="كلمة المرور" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" dir="ltr" required />
      </Field>
      <FormError message={state.error} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "جارٍ الدخول…" : "تسجيل الدخول"}
      </Button>
    </form>
  );
}
