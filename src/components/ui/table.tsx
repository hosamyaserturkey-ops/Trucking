import type { ReactNode } from "react";

// Wide tables scroll inside their card; the page itself never scrolls sideways.
export function Table({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <div className="relative overflow-x-auto">
      <table id={id} className={`w-full border-collapse text-sm ${className}`}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={`whitespace-nowrap border-b border-border bg-surface-2 px-3 py-2 text-start text-xs font-semibold text-muted ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`border-b border-border px-3 py-2 align-top ${className}`}>{children}</td>;
}

// A tinted row keeps its colour on hover, so the colour is never lost under the pointer.
const ROW_TONE = {
  success: "bg-success-soft/70 hover:bg-success-soft",
  danger: "bg-danger-soft/70 hover:bg-danger-soft",
} as const;

export function Tr({
  children,
  className = "",
  tone,
}: {
  children: ReactNode;
  className?: string;
  tone?: keyof typeof ROW_TONE;
}) {
  return <tr className={`${tone ? ROW_TONE[tone] : "hover:bg-surface-2"} ${className}`}>{children}</tr>;
}
