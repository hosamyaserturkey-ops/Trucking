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

export type DriverFuelOptions = {
  trips: DriverOption[];
  stations: DriverOption[];
  /** The driver's own truck, used when a fill-up is not tied to a trip. */
  truck: { id: string; code: string; lastOdometer: number | null; tankLiters: number | null } | null;
};

/** Trips, fuel stations and the driver's truck for the diesel form. */
export async function loadDriverFuelOptions(): Promise<DriverFuelOptions> {
  const supabase = await createClient();
  const [{ trips }, stationsRes, driverRes] = await Promise.all([
    loadDriverExpenseOptions(),
    supabase.from("suppliers").select("id, name").eq("kind", "fuel_station").eq("is_active", true).order("name"),
    supabase.from("drivers").select("default_truck_id, truck:trucks!drivers_default_truck_id_fkey(id, code, fuel_tank_liters)").maybeSingle(),
  ]);
  const t = driverRes.data?.truck as { id: string; code: string; fuel_tank_liters: number | null } | null | undefined;
  let lastOdometer: number | null = null;
  if (t) {
    const { data } = await supabase.from("truck_overview_v").select("odometer").eq("truck_id", t.id).maybeSingle();
    lastOdometer = data?.odometer ?? null;
  }
  return {
    trips,
    stations: (stationsRes.data ?? []).map((s) => ({ id: s.id, label: s.name })),
    truck: t ? { id: t.id, code: t.code, lastOdometer, tankLiters: t.fuel_tank_liters } : null,
  };
}
