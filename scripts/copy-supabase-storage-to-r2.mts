// One-off: copy the files that database rows point to from the old Supabase
// Storage buckets into the R2 bucket, under the same relative paths. Never
// deletes anything from Supabase. Safe to re-run: files already in R2 are skipped.
//
//   node --conditions=react-server scripts/copy-supabase-storage-to-r2.mts [--dry-run]
//
// Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, the R2_* variables,
// and COPY_EMAIL / COPY_PASSWORD of a manager account (it reads files through that
// user's session and RLS; no service key).
import { createClient } from "@supabase/supabase-js";
import { ALLOWED_TYPES, checkFile, objectKey, parsePath, putFile, type FileKind } from "../src/lib/storage.ts";

const dryRun = process.argv.includes("--dry-run");
const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
};

const supabase = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
  auth: { persistSession: false },
});
const { error: signInError } = await supabase.auth.signInWithPassword({ email: env("COPY_EMAIL"), password: env("COPY_PASSWORD") });
if (signInError) throw new Error(`Sign-in failed: ${signInError.message}`);

const files: { kind: FileKind; path: string; from: string }[] = [];
const [expenses, fills, docs] = await Promise.all([
  supabase.from("expenses").select("id, receipt_path").not("receipt_path", "is", null),
  supabase.from("fuel_fillups").select("id, receipt_path").not("receipt_path", "is", null),
  supabase.from("truck_documents").select("id, file_path").not("file_path", "is", null),
]);
for (const res of [expenses, fills, docs]) if (res.error) throw new Error(res.error.message);
for (const r of expenses.data ?? []) files.push({ kind: "receipts", path: r.receipt_path!, from: `expense ${r.id}` });
for (const r of fills.data ?? []) files.push({ kind: "receipts", path: r.receipt_path!, from: `fill-up ${r.id}` });
for (const r of docs.data ?? []) files.push({ kind: "truck-documents", path: r.file_path!, from: `document ${r.id}` });

const typeByExt = Object.fromEntries(Object.entries(ALLOWED_TYPES).map(([type, ext]) => [ext, type]));
let copied = 0;
let skipped = 0;
const failed: string[] = [];

for (const f of files) {
  const label = `${f.kind}/${f.path} (${f.from})`;
  const parsed = parsePath(f.path);
  if (!parsed) {
    failed.push(`${label}: path does not match the layout`);
    continue;
  }
  if ((await checkFile(objectKey(f.kind, f.path))).exists) {
    skipped++;
    console.log(`skip  ${label}: already in R2`);
    continue;
  }
  if (dryRun) {
    console.log(`would copy  ${label}`);
    continue;
  }
  // The old buckets were named like the kinds: "receipts" and "truck-documents".
  const { data, error } = await supabase.storage.from(f.kind).download(f.path);
  if (error || !data) {
    failed.push(`${label}: download failed (${error?.message ?? "no data"})`);
    continue;
  }
  const body = await data.arrayBuffer();
  const type = typeByExt[parsed.ext];
  await putFile(f.kind, f.path, body, type);
  const check = await checkFile(objectKey(f.kind, f.path));
  if (!check.exists || check.size !== body.byteLength) {
    failed.push(`${label}: not found in R2 after copy`);
    continue;
  }
  copied++;
  console.log(`copy  ${label}: ${body.byteLength} bytes`);
}

console.log(`\n${files.length} referenced file(s): ${copied} copied, ${skipped} already in R2, ${failed.length} failed${dryRun ? " (dry run)" : ""}`);
for (const f of failed) console.log(`FAIL  ${f}`);
process.exit(failed.length ? 1 : 0);
