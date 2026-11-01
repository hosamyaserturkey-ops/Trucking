import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";

export default async function ReportsPage() {
  await requireRole(...FINANCE_ROLES);
  redirect("/reports/trucks");
}
