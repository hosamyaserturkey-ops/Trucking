import { createClient } from "@/lib/supabase/server";
import { impliedKmPerLiter, isAbnormal } from "@/lib/fuel";

export type FuelCheck = { kmPerLiter: number | null; baseline: number | null; abnormal: boolean };

/**
 * For fill-ups waiting for review: the km/L each one implies (full-tank method,
 * against the truck's approved history) next to the truck's usual figure, so
 * a reviewer sees a suspicious entry before approving it.
 */
export async function loadFuelChecks(
  fills: { id: string; truck_id: string; filled_at: string; odometer: number; liters: number; is_full_tank: boolean }[],
): Promise<Map<string, FuelCheck>> {
  const out = new Map<string, FuelCheck>();
  if (fills.length === 0) return out;
  const supabase = await createClient();
  const truckIds = [...new Set(fills.map((f) => f.truck_id))];

  const [settingsRes, trucksRes, ...baselineRes] = await Promise.all([
    supabase.from("company_settings").select("fuel_anomaly_threshold_pct").maybeSingle(),
    supabase.from("trucks").select("id, expected_km_per_liter").in("id", truckIds),
    ...truckIds.map((id) =>
      supabase.from("fuel_efficiency_v").select("truck_id, baseline_km_per_liter").eq("truck_id", id).not("baseline_km_per_liter", "is", null).limit(1),
    ),
  ]);
  const threshold = Number(settingsRes.data?.fuel_anomaly_threshold_pct ?? 15);
  const baseline = new Map<string, number | null>();
  for (const t of trucksRes.data ?? []) baseline.set(t.id, t.expected_km_per_liter);
  for (const res of baselineRes) {
    const row = res.data?.[0];
    if (row?.truck_id && baseline.get(row.truck_id) == null) baseline.set(row.truck_id, row.baseline_km_per_liter);
  }

  const histories = await Promise.all(
    fills.map((f) =>
      supabase
        .from("fuel_fillups")
        .select("odometer, liters, is_full_tank")
        .eq("truck_id", f.truck_id)
        .eq("status", "approved")
        .lt("filled_at", f.filled_at)
        .order("filled_at", { ascending: false })
        .limit(20),
    ),
  );
  fills.forEach((f, i) => {
    const kmPerLiter = impliedKmPerLiter(f, (histories[i].data ?? []).map((h) => ({ ...h, liters: Number(h.liters) })));
    const base = baseline.get(f.truck_id) ?? null;
    out.set(f.id, { kmPerLiter, baseline: base, abnormal: isAbnormal(kmPerLiter, base, threshold) });
  });
  return out;
}
