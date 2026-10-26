import { createClient } from "@/lib/supabase/server";
import { DRIVER_CATEGORY_CODES } from "@/lib/driver-expense";
import { formatDate } from "@/lib/format";

export type DriverOption = { id: string; label: string };

/**
 * Trips and categories for the driver's expense form. RLS already limits trips
 * to the signed-in driver; the running trip comes first so it is the default.
 */
export async function loadDriverExpenseOptions(): Promise<{ trips: DriverOption[]; categories: DriverOption[] }> {
  const supabase = await createClient();
  const [tripsRes, catsRes] = await Promise.all([
    supabase
      .from("trip_profit_v")
      .select("trip_id, trip_no, start_date, from_name, to_name, status")
      .neq("status", "cancelled")
      .order("start_date", { ascending: false })
      .limit(20),
    supabase
      .from("expense_categories")
      .select("id, code, name_ar, sort_order")
      .in("code", [...DRIVER_CATEGORY_CODES])
      .order("sort_order"),
  ]);
  const rows = tripsRes.data ?? [];
  const ordered = [...rows.filter((t) => t.status === "in_progress"), ...rows.filter((t) => t.status !== "in_progress")];
  return {
    trips: ordered.map((t) => ({
      id: t.trip_id!,
      label: `#${t.trip_no} · ${t.from_name} ← ${t.to_name} · ${formatDate(t.start_date)}`,
    })),
    categories: (catsRes.data ?? []).map((c) => ({ id: c.id, label: c.name_ar })),
  };
}
