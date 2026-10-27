import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveRange, type DateRange } from "@/lib/date-range";

export type TruckPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Shared by the Truck 360 layout and its tabs (one query per request).
export const getTruck = cache(async (id: string) => {
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("truck_overview_v").select("*").eq("truck_id", id).maybeSingle();
  if (!data) notFound();
  return data;
});

export async function truckPage({ params, searchParams }: TruckPageProps) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const truck = await getTruck(id);
  const range: DateRange = resolveRange(sp);
  return { id, truck, range };
}

/**
 * PostgREST filter for trips dated inside the range. A trip counts on its end
 * date, or its start date while still running, matching truck_pnl_facts_v.
 */
export function tripInRange(range: DateRange): string {
  return [
    `and(end_date.gte.${range.from},end_date.lt.${range.to})`,
    `and(end_date.is.null,start_date.gte.${range.from},start_date.lt.${range.to})`,
  ].join(",");
}
