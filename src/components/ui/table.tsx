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

export function Tr({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <tr className={`hover:bg-surface-2 ${className}`}>{children}</tr>;
}
