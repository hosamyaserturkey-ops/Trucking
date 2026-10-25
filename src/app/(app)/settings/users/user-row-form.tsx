"use client";

import { useActionState, useState } from "react";
import type { UserSaveState } from "./actions";
import { ROLE_LABELS, type AppRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";

type Props = {
  email: string | null;
  fullName: string;
  role: AppRole | null;
  driverId: string | null;
  drivers: { id: string; full_name: string; taken: boolean }[];
  action: (prev: UserSaveState, formData: FormData) => Promise<UserSaveState>;
  isSelf: boolean;
};

export function UserRowForm({ email, fullName, role, driverId, drivers, action, isSelf }: Props) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [selectedRole, setSelectedRole] = useState<string>(role ?? "");

  return (
    <form action={formAction} className="grid gap-3 border-b border-border px-4 py-4 md:grid-cols-[1.4fr_1fr_1fr_1.2fr_auto] md:items-end">
      <div className="min-w-0">
        <p className="num truncate text-sm font-medium">{email}</p>
        {isSelf ? <p className="text-xs text-muted">(أنت)</p> : null}
        {!role ? <p className="text-xs text-warning">بانتظار تحديد الصلاحية</p> : null}
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted">
        الاسم
        <Input name="full_name" defaultValue={fullName} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        الصلاحية
        <Select name="role" value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)}>
          <option value="">بدون صلاحية</option>
          {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        سجل السائق
        <Select name="driver_id" defaultValue={driverId ?? ""} disabled={selectedRole !== "driver"}>
          <option value="">—</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id} disabled={d.taken && d.id !== driverId}>
              {d.full_name}
              {d.taken && d.id !== driverId ? " (مرتبط)" : ""}
            </option>
          ))}
        </Select>
      </label>
      <div className="flex flex-col gap-1">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "…" : "حفظ"}
        </Button>
      </div>
      {state.error ? <p className="text-sm text-danger md:col-span-5">{state.error}</p> : null}
      {state.saved && !state.error ? <p className="text-sm text-success md:col-span-5">تم الحفظ</p> : null}
    </form>
  );
}
