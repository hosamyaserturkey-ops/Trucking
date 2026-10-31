import { getProfile } from "@/lib/auth";
import { canSeeFinancials } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { loadEinvoiceInput } from "@/lib/einvoice-data";
import { buildEinvoiceXml } from "@/lib/jofotara-xml";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_CACHE = { "Cache-Control": "private, no-store" };

// The JoFotara file of an invoice (?kind=credit_note for its credit note), to
// check before or after sending. Before it is first sent, the UUID and counter
// are placeholders and the file name says "preview".
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile();
  if (!profile || !canSeeFinancials(profile.role)) return new Response("غير مسموح", { status: 403, headers: NO_CACHE });
  const { id } = await params;
  if (!UUID.test(id)) return new Response("غير موجود", { status: 404, headers: NO_CACHE });
  const kind = new URL(request.url).searchParams.get("kind") === "credit_note" ? "credit_note" : "invoice";
  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("einvoices")
    .select("id, icv, doc_no, issue_date, reason")
    .eq("invoice_id", id)
    .eq("kind", kind)
    .maybeSingle();
  const { input } = await loadEinvoiceInput(supabase, id, kind, doc);
  if (!input) return new Response("غير موجود", { status: 404, headers: NO_CACHE });
  const name = `jofotara-${input.docNo}${doc ? "" : "-preview"}.xml`.replace(/[^\w.-]/g, "_");
  return new Response(buildEinvoiceXml(input), {
    headers: { ...NO_CACHE, "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` },
  });
}
