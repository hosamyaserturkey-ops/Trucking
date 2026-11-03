import Link from "next/link";
import { CircleAlert, CircleCheck } from "lucide-react";
import type { ClaimStatus } from "@/lib/loading-sheet";

/** Row colour for a load: green once the customer is claimed (invoiced), red until then. */
export const CLAIM_TONE: Record<ClaimStatus, "success" | "danger"> = { claimed: "success", unclaimed: "danger" };

export const CLAIM_LABEL: Record<ClaimStatus, string> = { claimed: "تمت المطالبة", unclaimed: "لم تتم المطالبة" };

/**
 * The claim column: the colour is never the only sign, so the words are there
 * too (and go to the Excel export). The invoice number shows to roles that can
 * see invoices; it links to the invoice.
 */
export function ClaimStatusText({
  claim,
  invoiceId,
  invoiceNo,
}: {
  claim: ClaimStatus | null;
  invoiceId?: string | null;
  invoiceNo?: number | null;
}) {
  if (!claim) return <span className="text-muted">—</span>;
  if (claim === "unclaimed") {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-danger">
        <CircleAlert className="size-3.5 shrink-0" aria-hidden />
        {CLAIM_LABEL.unclaimed}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-success">
      <CircleCheck className="size-3.5 shrink-0" aria-hidden />
      {CLAIM_LABEL.claimed}
      {invoiceId && invoiceNo ? (
        <>
          <span aria-hidden>·</span>
          <Link href={`/invoices/${invoiceId}`} className="font-medium hover:underline">
            فاتورة <span className="num">{invoiceNo}</span>
          </Link>
        </>
      ) : null}
    </span>
  );
}
