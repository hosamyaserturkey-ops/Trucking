import { createClient } from "@/lib/supabase/server";

export type MaintenanceOptions = {
  trucks: { id: string; label: string; odometer: number | null }[];
  workshops: { id: string; label: string }[];
};

/** Dropdowns for work orders: active trucks with their last odometer, and workshops and parts suppliers. */
export async function loadMaintenanceOptions(keep: { truckId?: string | null; workshopId?: string | null } = {}): Promise<MaintenanceOptions> {
  const supabase = await createClient();
  const [trucks, suppliers] = await Promise.all([
    supabase.from("truck_overview_v").select("truck_id, code, plate_number, odometer, is_active").order("code"),
    supabase.from("suppliers").select("id, name, kind, is_active").neq("kind", "fuel_station").order("name"),
  ]);
  // Workshops first; an inactive record stays listed when the order already uses it.
  const order = { workshop: 0, parts: 1, tires: 2, other: 3 } as Record<string, number>;
  return {
    trucks: (trucks.data ?? [])
      .filter((t) => t.is_active || t.truck_id === keep.truckId)
      .map((t) => ({ id: t.truck_id!, label: `${t.code} · ${t.plate_number}`, odometer: t.odometer })),
    workshops: (suppliers.data ?? [])
      .filter((s) => s.is_active || s.id === keep.workshopId)
      .sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.name.localeCompare(b.name, "ar"))
      .map((s) => ({ id: s.id, label: s.name })),
  };
}
