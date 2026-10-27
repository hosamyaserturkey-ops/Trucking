import { createClient } from "@/lib/supabase/server";
import { loadTripOptions, type TripOptions } from "@/lib/trip-options";
import { formatDate } from "@/lib/format";

export type OfficeOptions = Pick<TripOptions, "trucks" | "drivers" | "rates"> & {
  trips: { id: string; label: string; truckId: string; driverId: string | null }[];
  stations: { id: string; label: string }[];
  suppliers: { id: string; label: string }[];
  categories: { id: string; label: string }[];
};

/** Dropdowns for the office diesel and expense forms (active records, recent trips). */
export async function loadOfficeOptions(): Promise<OfficeOptions> {
  const supabase = await createClient();
  const [base, tripsRes, suppliersRes, catsRes] = await Promise.all([
    loadTripOptions(),
    supabase
      .from("trip_profit_v")
      .select("trip_id, trip_no, truck_id, driver_id, from_name, to_name, start_date, status")
      .neq("status", "cancelled")
      .order("start_date", { ascending: false })
      .limit(150),
    supabase.from("suppliers").select("id, name, kind").eq("is_active", true).order("name"),
    supabase.from("expense_categories").select("id, name_ar").eq("is_active", true).order("sort_order"),
  ]);
  const suppliers = suppliersRes.data ?? [];
  return {
    trucks: base.trucks,
    drivers: base.drivers,
    rates: base.rates,
    trips: (tripsRes.data ?? []).map((t) => ({
      id: t.trip_id!,
      label: `#${t.trip_no} · ${t.from_name} ← ${t.to_name} · ${formatDate(t.start_date)}`,
      truckId: t.truck_id!,
      driverId: t.driver_id,
    })),
    stations: suppliers.filter((s) => s.kind === "fuel_station").map((s) => ({ id: s.id, label: s.name })),
    suppliers: suppliers.map((s) => ({ id: s.id, label: s.name })),
    categories: (catsRes.data ?? []).map((c) => ({ id: c.id, label: c.name_ar })),
  };
}
