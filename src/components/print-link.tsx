"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

export function PrintLink({ truckId }: { truckId: string }) {
  const query = useSearchParams().toString();
  return (
    <Link
      href={`/print/trucks/${truckId}${query ? `?${query}` : ""}`}
      target="_blank"
      className={buttonClass("secondary")}
    >
      <Printer className="size-4" aria-hidden />
      كشف للطباعة
    </Link>
  );
}
