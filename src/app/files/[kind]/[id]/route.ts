import { loadFileRow, VIEW_KINDS, type ViewKind } from "@/lib/file-access";
import { createViewLink } from "@/lib/storage";

export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

function notFound() {
  return new Response("الملف غير موجود أو لا تملك صلاحية عرضه", {
    status: 404,
    headers: { ...NO_CACHE, "Content-Type": "text/plain; charset=utf-8" },
  });
}

// Open a stored file. The row is read with the user's own session, so RLS
// decides; the redirect is to a fresh signed link that expires in 10 minutes.
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!VIEW_KINDS.includes(kind as ViewKind)) return notFound();
  const file = await loadFileRow(kind as ViewKind, id);
  if (!file) return notFound();
  try {
    const url = await createViewLink(file.kind, file.path);
    return new Response(null, { status: 302, headers: { ...NO_CACHE, Location: url } });
  } catch {
    return new Response("تعذر فتح الملف حالياً", { status: 503, headers: { ...NO_CACHE, "Content-Type": "text/plain; charset=utf-8" } });
  }
}
