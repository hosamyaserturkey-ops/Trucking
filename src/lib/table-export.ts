// Turning a table on the screen into spreadsheet rows (the "تصدير Excel"
// button): what the user sees, with amounts as numbers Excel can add up and
// without the action column. Pure; the button reads the cells from the page.

export type ScreenCell = {
  /** The text as shown (line breaks inside the cell allowed). */
  text: string;
  /** An exact value the page put on the cell (data-x), e.g. a signed balance. */
  raw?: string | null;
  /** colspan */
  span?: number;
};

/** Header texts of columns that hold buttons, not data. */
const ACTION_HEADERS = new Set(["", "إجراءات"]);

const AMOUNT = /^-?(\d{1,3}(,\d{3})+|\d+)\.\d+$/;

/** One cell as a spreadsheet value: an amount ("1,250.500") becomes a number; the rest stays text. */
export function exportValue(cell: ScreenCell): string | number {
  if (cell.raw !== undefined && cell.raw !== null && cell.raw !== "" && Number.isFinite(Number(cell.raw))) return Number(cell.raw);
  const text = cell.text
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
  return AMOUNT.test(text) ? Number(text.replace(/,/g, "")) : text;
}

/**
 * The rows of a table (the first row is its header) as spreadsheet rows:
 * spanned cells keep their columns aligned, and action columns are dropped.
 */
export function tableRows(rows: ScreenCell[][]): (string | number)[][] {
  const grid = rows.map((cells) => {
    const out: (string | number)[] = [];
    for (const c of cells) {
      out.push(exportValue(c));
      for (let i = 1; i < (c.span ?? 1); i++) out.push("");
    }
    return out;
  });
  const header = grid[0] ?? [];
  const keep = header.map((h, i) => (ACTION_HEADERS.has(String(h)) ? -1 : i)).filter((i) => i >= 0);
  return grid.map((r) => keep.map((i) => r[i] ?? ""));
}

/** Column widths for the sheet: the longest text in each column, within limits. */
export function columnWidths(rows: (string | number)[][]): number[] {
  const widths: number[] = [];
  for (const r of rows) r.forEach((v, i) => (widths[i] = Math.max(widths[i] ?? 8, Math.min(45, String(v).length + 2))));
  return widths;
}
