import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { FieldDef, RefTable } from "@/lib/master-data";

/** Master data screens use table names from config, so they go through an untyped client. */
export async function untypedClient(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient;
}

const REF_SELECT: Record<RefTable, { columns: string; label: (r: Record<string, string>) => string }> = {
  trucks: { columns: "id, code, plate_number", label: (r) => `${r.code} · ${r.plate_number}` },
  drivers: { columns: "id, full_name", label: (r) => r.full_name },
  accounts: { columns: "id, code, name_ar", label: (r) => `${r.code} ${r.name_ar}` },
};

export type RefOptions = Record<string, { value: string; label: string }[]>;

/** Options for every reference field, keyed by field name. */
export async function loadRefOptions(fields: FieldDef[]): Promise<RefOptions> {
  const supabase = await untypedClient();
  const out: RefOptions = {};
  await Promise.all(
    fields
      .filter((f) => f.type === "ref" && f.ref)
      .map(async (f) => {
        const spec = REF_SELECT[f.ref!.table];
        const { data } = await supabase.from(f.ref!.table).select(spec.columns).order(f.ref!.orderBy);
        out[f.name] = ((data ?? []) as unknown as Record<string, string>[]).map((r) => ({
          value: r.id,
          label: spec.label(r),
        }));
      }),
  );
  return out;
}
