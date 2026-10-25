"use client";

import { Printer } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("primary", "print:hidden")}>
      <Printer className="size-4" aria-hidden />
      طباعة / حفظ PDF
    </button>
  );
}
