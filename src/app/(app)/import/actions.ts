"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/roles";
import { untypedClient } from "@/lib/master-data-server";
import { describeDbError } from "@/lib/master-data-parse";
import { decideUpload } from "@/lib/file-access";
import { IMPORT_TYPES, parseImport, type ImportRow, type ImportType } from "@/lib/import";

export type ImportStatus = "new" | "exists" | "opening" | "error";
export type ImportLine = { line: number; label: string; status: ImportStatus; message: string | null };
export type ImportResult = {
  error: string | null;
  lines: ImportLine[];
  counts: Record<ImportStatus, number>;
  imported?: number;
};

const MAX_ROWS = 2000;
const EMPTY: Record<ImportStatus, number> = { new: 0, exists: 0, opening: 0, error: 0 };

/** Values from the browser are untrusted: a sheet is a list of rows of short strings. */
function validSheet(rows: unknown): rows is string[][] {
  return (
    Array.isArray(rows) &&
    rows.length <= MAX_ROWS + 1 &&
    rows.every((r) => Array.isArray(r) && r.length <= 60 && r.every((c) => typeof c === "string" && c.length <= 500))
  );
}

type Plan = {
  type: ImportType;
  rows: ImportRow[];
  lines: ImportLine[];
  existingId: Map<string, string>;
  truckIds: Map<string, string>;
  openingDate: string | null;
};

/** Check the sheet against the rules and what is already in the system. */
async function plan(type: ImportType, sheet: unknown): Promise<{ error: string } | Plan> {
  const profile = await requireRole(...FINANCE_ROLES);
  if (!IMPORT_TYPES.includes(type)) return { error: "نوع الاستيراد غير معروف" };
  if (!validSheet(sheet)) return { error: `الملف كبير أو غير مقروء (الحد ${MAX_ROWS} صف)` };
  const parsed = parseImport(type, sheet);
  if (parsed.error) return { error: parsed.error };

  const supabase = await untypedClient();
  const keyCols = type === "trucks" ? "id, code, plate_number" : type === "drivers" ? "id, full_name, national_id" : type === "clients" ? "id, name, ref_code" : "id, name";
  const [existingRes, trucksRes, settingsRes, openingRes, advancesRes] = await Promise.all([
    supabase.from(type).select(keyCols),
    type === "drivers" ? supabase.from("trucks").select("id, code") : Promise.resolve({ data: [] }),
    supabase.from("company_settings").select("opening_date").maybeSingle(),
    type === "clients" || type === "suppliers"
      ? supabase.from("opening_balances").select("client_id, supplier_id").eq("kind", type === "clients" ? "client" : "supplier")
      : Promise.resolve({ data: [] }),
    type === "drivers" ? supabase.from("driver_advances").select("driver_id").eq("method", "opening") : Promise.resolve({ data: [] }),
  ]);
  if (existingRes.error) return { error: describeDbError(existingRes.error) };
  const existing = (existingRes.data ?? []) as unknown as Record<string, string | null>[];
  const lower = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

  const existingId = new Map<string, string>();
  for (const r of existing) {
    if (type === "trucks") existingId.set(lower(r.code), r.id!);
    else if (type === "drivers") {
      if (r.national_id) existingId.set(lower(r.national_id), r.id!);
      existingId.set(lower(r.full_name), r.id!);
    } else existingId.set(lower(r.name), r.id!);
  }
  const plates = new Set(type === "trucks" ? existing.map((r) => lower(r.plate_number)) : []);
  const refCodes = new Set(type === "clients" ? existing.map((r) => lower(r.ref_code)).filter(Boolean) : []);
  const truckIds = new Map(((trucksRes.data ?? []) as { id: string; code: string }[]).map((t) => [lower(t.code), t.id]));
  const withOpening = new Set(
    [...((openingRes.data ?? []) as { client_id: string | null; supplier_id: string | null }[]).map((o) => o.client_id ?? o.supplier_id),
     ...((advancesRes.data ?? []) as { driver_id: string }[]).map((a) => a.driver_id)].filter(Boolean) as string[],
  );
  const openingDate = (settingsRes.data as { opening_date: string | null } | null)?.opening_date ?? null;
  const canFileTruckDocs = decideUpload(profile.role, "truck_document");

  const lines: ImportLine[] = parsed.rows.map((r) => {
    const id = existingId.get(r.key) ?? (type === "drivers" ? existingId.get(lower(r.label)) : undefined);
    const hasOpening = !!r.opening || !!r.openingAdvance;
    let message = r.error;
    if (!message && hasOpening && !openingDate) message = "حدد تاريخ بدء العمل في صفحة الأرصدة الافتتاحية أولاً";
    if (!message && r.defaultTruck && !truckIds.has(lower(r.defaultTruck))) message = `الشاحنة ${r.defaultTruck} غير موجودة`;
    if (!message && !id && type === "trucks" && plates.has(lower(String(r.values.plate_number ?? "")))) message = "رقم اللوحة مسجل لشاحنة أخرى";
    if (!message && !id && type === "clients" && r.values.ref_code && refCodes.has(lower(String(r.values.ref_code)))) message = "رمز الإشارة مستخدم لزبون آخر";
    if (!message && !id && type === "trucks" && r.licence && !canFileTruckDocs) message = "رخصة الشاحنة يضيفها المدير أو المنسق؛ احذف عموديها أو اطلب منهما الاستيراد";
    if (message) return { line: r.line, label: r.label, status: "error", message };
    if (!id) return { line: r.line, label: r.label, status: "new", message: null };
    if (hasOpening && !withOpening.has(id)) return { line: r.line, label: r.label, status: "opening", message: "موجود؛ سيُضاف رصيده الافتتاحي فقط" };
    return { line: r.line, label: r.label, status: "exists", message: hasOpening ? "موجود ورصيده الافتتاحي مسجل؛ سيتم تجاوزه" : "موجود؛ سيتم تجاوزه" };
  });
  return { type, rows: parsed.rows, lines, existingId, truckIds, openingDate };
}

function counts(lines: ImportLine[]): Record<ImportStatus, number> {
  const c = { ...EMPTY };
  for (const l of lines) c[l.status] += 1;
  return c;
}

/** What importing this sheet would do, row by row. Nothing is saved. */
export async function previewImport(type: ImportType, sheet: string[][]): Promise<ImportResult> {
  const p = await plan(type, sheet);
  if ("error" in p) return { error: p.error, lines: [], counts: EMPTY };
  return { error: null, lines: p.lines, counts: counts(p.lines) };
}

/** Import the sheet: new records, their opening balances and truck licences. Refused while any row has an error. */
export async function runImport(type: ImportType, sheet: string[][]): Promise<ImportResult> {
  const p = await plan(type, sheet);
  if ("error" in p) return { error: p.error, lines: [], counts: EMPTY };
  const c = counts(p.lines);
  if (c.error) return { error: "صحح الصفوف التي فيها أخطاء ثم ارفع الملف من جديد", lines: p.lines, counts: c };

  const supabase = await untypedClient();
  const lower = (v: string) => v.trim().toLowerCase();
  const byLine = new Map(p.lines.map((l) => [l.line, l.status]));
  const fresh = p.rows.filter((r) => byLine.get(r.line) === "new");

  // 1. New records, in one statement (all or nothing).
  const ids = new Map<number, string>();
  if (fresh.length) {
    const values = fresh.map((r) =>
      type === "drivers" ? { ...r.values, default_truck_id: r.defaultTruck ? p.truckIds.get(lower(r.defaultTruck)) ?? null : null } : r.values,
    );
    const keyCols = type === "trucks" ? "code" : type === "drivers" ? "full_name, national_id" : "name";
    const { data, error } = await supabase.from(type).insert(values).select(`id, ${keyCols}`);
    if (error) return { error: describeDbError(error), lines: p.lines, counts: c };
    // Match by the record's own key (as parseImport builds it): the order rows come back in is not promised.
    const keyOf = (d: Record<string, string | null>) => lower((type === "trucks" ? d.code : type === "drivers" ? d.national_id || d.full_name : d.name) ?? "");
    const byKey = new Map((data as unknown as Record<string, string | null>[]).map((d) => [keyOf(d), d.id as string]));
    for (const r of fresh) {
      const id = byKey.get(r.key);
      if (id) ids.set(r.line, id);
    }
  }
  const idOf = (r: ImportRow) => ids.get(r.line) ?? p.existingId.get(r.key) ?? p.existingId.get(lower(r.label));
  const withExtras = p.rows.filter((r) => ["new", "opening"].includes(byLine.get(r.line) ?? ""));

  // 2. Truck licences, opening balances and the advances drivers hold.
  const problems: string[] = [];
  if (type === "trucks") {
    const docs = fresh.filter((r) => r.licence).map((r) => ({ truck_id: idOf(r), doc_type: "registration", ...r.licence }));
    if (docs.length) {
      const { error } = await supabase.from("truck_documents").insert(docs);
      if (error) problems.push(`رخص الشاحنات: ${describeDbError(error)}`);
    }
  }
  if (type === "clients" || type === "suppliers") {
    const kind = type === "clients" ? "client" : "supplier";
    const rows = withExtras.filter((r) => r.opening).map((r) => ({ kind, [`${kind}_id`]: idOf(r), ...r.opening }));
    if (rows.length) {
      const { error } = await supabase.from("opening_balances").insert(rows);
      if (error) problems.push(`الأرصدة الافتتاحية: ${describeDbError(error)}`);
    }
  }
  if (type === "drivers") {
    const rows = withExtras
      .filter((r) => r.openingAdvance)
      .map((r) => ({ driver_id: idOf(r), issued_on: p.openingDate, amount_minor: r.openingAdvance, method: "opening", notes: "عهدة من الأرصدة الافتتاحية" }));
    if (rows.length) {
      const { error } = await supabase.from("driver_advances").insert(rows);
      if (error) problems.push(`العهد الافتتاحية: ${describeDbError(error)}`);
    }
  }

  revalidatePath("/", "layout");
  return {
    error: problems.length ? `استُورد ${fresh.length} سجل، لكن: ${problems.join(" · ")}` : null,
    lines: p.lines,
    counts: c,
    imported: fresh.length,
  };
}
