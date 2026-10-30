import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

// Just enough of .xlsx for imports: read the first worksheet as rows of text,
// and write a one-sheet workbook (a template with a bold header row). Runs in
// the browser and in tests. No formulas, merged cells or multiple sheets.

export class XlsxError extends Error {}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? "";
  });
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Attributes of one XML start tag. */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
}

/** The text of a shared or inline string: every <t> run, without phonetic hints. */
function textOf(fragment: string): string {
  const body = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) out += decode(m[1] ?? "");
  return out;
}

/** "AB" → 27 (0-based column index). */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 0 → "A", 27 → "AB". */
export function columnName(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * The first worksheet of an .xlsx file as rows of cell text ("" for empty
 * cells). Numbers come as Excel stores them; a typed date is a serial number
 * (see excelDate). Trailing empty rows are dropped.
 */
export function readSheet(data: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new XlsxError("الملف ليس ملف Excel صالحاً (.xlsx)");
  }
  // Some writers prefix every tag (<x:row>); drop the prefixes.
  const read = (path: string) => (files[path] ? strFromU8(files[path]).replace(/<(\/?)[A-Za-z]\w*:(?=\w)/g, "<$1") : null);

  const shared: string[] = [];
  const sst = read("xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) shared.push(textOf(m[1] ?? ""));

  let sheetPath = "xl/worksheets/sheet1.xml";
  const workbook = read("xl/workbook.xml");
  const rels = read("xl/_rels/workbook.xml.rels");
  const firstSheet = workbook ? /<sheet\b[^>]*>/.exec(workbook)?.[0] : undefined;
  const rid = firstSheet ? attrs(firstSheet)["r:id"] : undefined;
  if (rid && rels) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const a = attrs(m[0]);
      if (a.Id === rid && a.Target) {
        const target = a.Target.replace(/^\//, "");
        sheetPath = target.startsWith("xl/") ? target : `xl/${target}`;
      }
    }
  }
  const xml = read(sheetPath);
  if (!xml) throw new XlsxError("لم أجد ورقة عمل في الملف");

  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNo = Number(attrs(rm[1]).r) || rows.length + 1;
    const cells: string[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attrs(cm[1]);
      const col = a.r ? columnIndex(a.r) : next;
      next = col + 1;
      const inner = cm[2] ?? "";
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = "";
      if (a.t === "s") value = shared[Number(v)] ?? "";
      else if (a.t === "inlineStr") value = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
      else if (a.t === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (a.t === "e") value = "";
      else value = decode(v ?? "");
      while (cells.length < col) cells.push("");
      cells[col] = value.trim();
    }
    while (rows.length < rowNo - 1) rows.push([]);
    rows[rowNo - 1] = cells;
  }
  while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop();
  return rows;
}

/**
 * A date cell as YYYY-MM-DD: an Excel serial number, or text written as
 * 2026-12-31, 31/12/2026 or 31-12-2026. Null when it is none of these.
 */
export function excelDate(text: string): string | null {
  const t = text.trim();
  if (/^\d{4,5}(\.\d+)?$/.test(t)) {
    const serial = Math.floor(Number(t));
    if (serial < 20000 || serial > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
  }
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) return isoIfValid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) return isoIfValid(+m[3], +m[2], +m[1]);
  return null;
}

function isoIfValid(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * A one-sheet workbook, right-to-left when asked. The header row (the first
 * unless headerRow says otherwise) is bold and stays in view; rows above it
 * (a title) are bold too.
 */
export function writeSheet(
  rows: (string | number | null)[][],
  opts: { sheetName: string; rtl?: boolean; widths?: number[]; headerRow?: number },
): Uint8Array {
  const header = opts.headerRow ?? 0;
  const cols = (opts.widths ?? []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          if (v === null || v === "") return "";
          const ref = `${columnName(c)}${r + 1}`;
          const style = r <= header ? ' s="1"' : "";
          return typeof v === "number"
            ? `<c r="${ref}"${style}><v>${v}</v></c>`
            : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escape(v)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"${opts.rtl ? ' rightToLeft="1"' : ""}>` +
    `<pane ySplit="${header + 1}" topLeftCell="A${header + 2}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${sheetRows}</sheetData></worksheet>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${escape(opts.sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    ),
    "xl/styles.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
        `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
        `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
        `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
        `</styleSheet>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  };
  return zipSync(files);
}
