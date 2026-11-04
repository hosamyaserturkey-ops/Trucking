import type { ReactNode } from "react";

const SIZE = { sm: "text-xs", md: "text-sm", lg: "text-base" } as const;

/**
 * A number plate for a truck code or a load reference (T-04, ARB-0041): the
 * things people read out over the phone. Always left to right.
 */
export function Plate({ children, size = "sm", title }: { children: ReactNode; size?: keyof typeof SIZE; title?: string }) {
  if (children === null || children === undefined || children === "") return <span className="text-muted">—</span>;
  return (
    <span className={`plate ${SIZE[size]}`} title={title}>
      <span>{children}</span>
    </span>
  );
}
