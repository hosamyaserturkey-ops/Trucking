import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/money";
import type { LastFuelPrices } from "@/components/fuel-quantity-fields";

/**
 * The last price paid per unit at each station (and at any station), for the
 * fill-up forms to suggest. A driver only sees his own fill-ups, so his
 * suggestions come from his own receipts.
 */
export async function loadLastFuelPrices(): Promise<LastFuelPrices> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("fuel_fillups")
    .select("station_id, qty_unit, currency, unit_price_minor")
    .neq("status", "rejected")
    .order("filled_at", { ascending: false })
    .limit(400);
  const out: LastFuelPrices = {};
  for (const f of data ?? []) {
    const price = formatMoney(f.unit_price_minor, f.currency, { withCurrency: false });
    for (const station of [f.station_id, "*"]) {
      const key = `${station}|${f.qty_unit}|${f.currency}`;
      if (station && !(key in out)) out[key] = price;
    }
  }
  return out;
}
