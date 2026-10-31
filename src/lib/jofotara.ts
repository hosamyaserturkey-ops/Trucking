import "server-only";

// The only code that talks to JoFotara. Its credentials are server secrets
// (JOFOTARA_CLIENT_ID, JOFOTARA_SECRET_KEY), never stored in the database nor
// sent to browsers; they come from the JoFotara portal (ربط الأنظمة).

const DEFAULT_URL = "https://backend.jofotara.gov.jo/core/invoices/";

export type JoFotaraConfig = { clientId: string; secretKey: string; url: string };

export function jofotaraConfig(env: Record<string, string | undefined> = process.env): JoFotaraConfig | null {
  const clientId = env.JOFOTARA_CLIENT_ID?.trim() ?? "";
  const secretKey = env.JOFOTARA_SECRET_KEY?.trim() ?? "";
  const url = env.JOFOTARA_URL?.trim() || DEFAULT_URL;
  if (!clientId || !secretKey || !/^https:\/\//.test(url)) return null;
  return { clientId, secretKey, url };
}

/** Send a base64 UBL invoice. Returns JoFotara's HTTP status and body, or why it could not be reached. */
export async function sendEinvoice(invoiceBase64: string, config: JoFotaraConfig): Promise<{ httpStatus: number; body: unknown } | { error: string }> {
  let res: Response;
  try {
    res = await fetch(config.url, {
      method: "POST",
      headers: { "Client-Id": config.clientId, "Secret-Key": config.secretKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ invoice: invoiceBase64 }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { error: timeout ? "لم يردّ نظام الفوترة الوطني خلال 30 ثانية؛ حاول لاحقاً" : "تعذر الاتصال بنظام الفوترة الوطني؛ حاول لاحقاً" };
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON (a gateway error page, for instance): keep the text.
  }
  return { httpStatus: res.status, body };
}

/** Hex SHA-256 of the file sent, kept with the record. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** JoFotara's answer as kept in the database: the large signed copy is dropped if the answer is very big. */
export function responseToStore(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return typeof body === "string" ? { text: body.slice(0, 2000) } : null;
  const copy = { ...(body as Record<string, unknown>) };
  if (JSON.stringify(copy).length > 200_000) delete copy.EINV_SINGED_INVOICE;
  return copy;
}
