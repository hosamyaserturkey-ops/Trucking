import { createClient } from "@/lib/supabase/server";

export type TripOptions = {
  trucks: { id: string; label: string; odometer: number | null; driverId: string | null }[];
  drivers: { id: string; label: string }[];
  clients: { id: string; label: string; currency: string }[];
  locations: { id: string; label: string }[];
  rates: Record<string, string>;
};

/** Everything the trip form's dropdowns need, active records only. */
export async function loadTripOptions(): Promise<TripOptions> {
  const supabase = await createClient();
  const [trucks, drivers, clients, locations, currencies] = await Promise.all([
    supabase.from("truck_overview_v").select("truck_id, code, plate_number, odometer, current_driver_id, is_active").order("code"),
    supabase.from("drivers").select("id, full_name, default_truck_id, is_active").eq("is_active", true).order("full_name"),
    supabase.from("clients").select("id, name, default_currency").eq("is_active", true).order("name"),
    supabase.from("locations").select("id, name").eq("is_active", true).order("name"),
    supabase.from("currencies").select("code, rate_to_base"),
  ]);
  const defaultDriver = new Map((drivers.data ?? []).map((d) => [d.default_truck_id, d.id]));
  return {
    trucks: (trucks.data ?? [])
      .filter((t) => t.is_active)
      .map((t) => ({
        id: t.truck_id!,
        label: `${t.code} · ${t.plate_number}`,
        odometer: t.odometer,
        driverId: t.current_driver_id ?? defaultDriver.get(t.truck_id) ?? null,
      })),
    drivers: (drivers.data ?? []).map((d) => ({ id: d.id, label: d.full_name })),
    clients: (clients.data ?? []).map((c) => ({ id: c.id, label: c.name, currency: c.default_currency })),
    locations: (locations.data ?? []).map((l) => ({ id: l.id, label: l.name })),
    rates: Object.fromEntries((currencies.data ?? []).map((c) => [c.code, String(c.rate_to_base ?? 1)])),
  };
}
