"use client";

import { useRef, useState, useTransition } from "react";
import { Download, Upload } from "lucide-react";
import type { ImportResult, ImportStatus } from "@/app/(app)/import/actions";
import { IMPORT_DEFS, IMPORT_TYPES, templateRows, type ImportType } from "@/lib/import";
import { readSheet, writeSheet, XlsxError } from "@/lib/xlsx";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, FormError, Select } from "@/components/ui/form";
import { Table, Td, Th, Tr } from "@/components/ui/table";

type Action = (type: ImportType, sheet: string[][]) => Promise<ImportResult>;

const STATUS: Record<ImportStatus, { label: string; tone: "success" | "neutral" | "info" | "danger" }> = {
  new: { label: "جديد", tone: "success" },
  opening: { label: "رصيد افتتاحي فقط", tone: "info" },
  exists: { label: "موجود", tone: "neutral" },
  error: { label: "خطأ", tone: "danger" },
};

/**
 * Pick what to import, download its template, upload the filled sheet: it is
 * read in the browser, checked on the server row by row, and imported only
 * when no row has an error.
 */
export function ImportForm({ preview, run }: { preview: Action; run: Action }) {
  const [type, setType] = useState<ImportType>("clients");
  const [sheet, setSheet] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setSheet(null);
    setResult(null);
    setDone(null);
    setError(null);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function download() {
    const def = IMPORT_DEFS[type];
    const bytes = writeSheet(templateRows(type), { sheetName: def.title, rtl: true, widths: def.columns.map((c) => c.width) });
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    // The link must be in the page, and its address alive until the download starts, or the name is lost.
    const a = document.createElement("a");
    a.href = url;
    // An ASCII name: some browsers drop an Arabic file name and save as "download".
    a.download = `${type === "clients" ? "customers" : type}-template.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function onFile(file: File | undefined) {
    setResult(null);
    setDone(null);
    setError(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const rows = readSheet(new Uint8Array(await file.arrayBuffer()));
      setSheet(rows);
      startTransition(async () => setResult(await preview(type, rows)));
    } catch (e) {
      setSheet(null);
      setError(e instanceof XlsxError ? e.message : "تعذر قراءة الملف؛ احفظه بصيغة Excel ‏(.xlsx)");
    }
  }

  const c = result?.counts;
  const willImport = c ? c.new + c.opening : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="ماذا تستورد؟" htmlFor="import_type">
          <Select
            id="import_type"
            value={type}
            onChange={(e) => {
              setType(e.target.value as ImportType);
              reset();
            }}
          >
            {IMPORT_TYPES.map((t) => (
              <option key={t} value={t}>
                {IMPORT_DEFS[t].title}
              </option>
            ))}
          </Select>
        </Field>
        <button type="button" onClick={download} className={buttonClass("secondary")}>
          <Download className="size-4" aria-hidden />
          تنزيل قالب {IMPORT_DEFS[type].title}
        </button>
        <label className={`${buttonClass("primary")} cursor-pointer`}>
          <Upload className="size-4" aria-hidden />
          {fileName ? "رفع ملف آخر" : "رفع الملف المعبّأ"}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            data-testid="import-file"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
      </div>
      {fileName ? (
        <p className="text-sm text-muted">
          الملف: <span dir="ltr">{fileName}</span>
          {pending ? " · جارٍ الفحص…" : ""}
        </p>
      ) : null}
      <FormError message={error ?? result?.error ?? null} />

      {done && !done.error ? (
        <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
          تم الاستيراد: {done.imported} سجل جديد{done.counts.opening ? ` و${done.counts.opening} رصيد افتتاحي لسجلات موجودة` : ""}.
        </p>
      ) : null}

      {result && result.lines.length ? (
        <>
          <p className="text-sm">
            جديد: <strong className="num">{c?.new}</strong> · رصيد افتتاحي فقط: <strong className="num">{c?.opening}</strong> · موجود (يُتجاوز):{" "}
            <strong className="num">{c?.exists}</strong> · أخطاء: <strong className={`num ${c?.error ? "text-danger" : ""}`}>{c?.error}</strong>
          </p>
          <Table>
            <thead>
              <tr>
                <Th>الصف</Th>
                <Th>{IMPORT_DEFS[type].columns[0].header}</Th>
                <Th>الحالة</Th>
                <Th>ملاحظة</Th>
              </tr>
            </thead>
            <tbody>
              {result.lines.map((l) => (
                <Tr key={l.line} className={l.status === "error" ? "bg-danger-soft/40" : ""}>
                  <Td className="num">{l.line}</Td>
                  <Td className="whitespace-nowrap">{l.label}</Td>
                  <Td>
                    <Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge>
                  </Td>
                  <Td className="text-xs">{l.message ?? ""}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {!done ? (
            <div>
              <Button
                type="button"
                disabled={pending || !sheet || !!c?.error || willImport === 0}
                onClick={() =>
                  sheet &&
                  startTransition(async () => {
                    const r = await run(type, sheet);
                    setResult(r);
                    if (r.imported !== undefined) setDone(r);
                  })
                }
              >
                {pending ? "جارٍ الاستيراد…" : c?.error ? "صحح الأخطاء أولاً" : willImport ? `استيراد ${willImport} سجل` : "لا جديد للاستيراد"}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
