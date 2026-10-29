"use client";

import { FileSpreadsheet } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { columnWidths, tableRows, type ScreenCell } from "@/lib/table-export";
import { todayIso } from "@/lib/date-range";
import { writeSheet } from "@/lib/xlsx";

/**
 * «تصدير Excel»: saves the table on the screen (by its id) as an .xlsx file,
 * with a title row. Amounts become numbers; the action column is left out.
 */
export function ExportButton({ tableId, file, title }: { tableId: string; file: string; title: string }) {
  function exportTable() {
    const table = document.getElementById(tableId) as HTMLTableElement | null;
    if (!table) return;
    const cells: ScreenCell[][] = Array.from(table.rows).map((tr) =>
      Array.from(tr.cells).map((c) => ({
        text: c.innerText,
        raw: c.dataset.x ?? c.querySelector<HTMLElement>("[data-x]")?.dataset.x ?? null,
        span: c.colSpan,
      })),
    );
    const rows = tableRows(cells);
    const sheet = [[title], [], ...rows];
    const bytes = writeSheet(sheet, { sheetName: "كشف", rtl: true, widths: columnWidths(rows), headerRow: 2 });
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    // In the page, ASCII name, address alive until the download starts: or browsers save it as "download".
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file}-${todayIso()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  return (
    <button type="button" onClick={exportTable} className={`${buttonClass("secondary")} print:hidden`}>
      <FileSpreadsheet className="size-4" aria-hidden />
      تصدير Excel
    </button>
  );
}
