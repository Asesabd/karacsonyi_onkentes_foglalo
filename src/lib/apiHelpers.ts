import { NextResponse } from "next/server";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/rateLimit";

export function jsonError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

/**
 * Defense-in-depth CSRF check for state-changing endpoints: browsers always
 * send an Origin header on cross-origin fetch/form submissions, so if one is
 * present it must match this deployment's own origin. Same-site admin
 * cookies (SameSite=Strict) are the primary defense for the admin API; this
 * catches the rest and costs nothing for legitimate same-origin requests
 * (which is all this app ever issues).
 */
export function enforceSameOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null; // same-origin requests and most non-browser clients omit this header

  const requestUrl = new URL(request.url);
  if (new URL(origin).host !== requestUrl.host) {
    return jsonError(403, "FORBIDDEN", "Érvénytelen kérés forrás.");
  }
  return null;
}

/**
 * Applies a per-IP rate limit to a write endpoint. Returns a 429 response
 * when exceeded, otherwise null (caller proceeds).
 */
export async function enforceRateLimit(
  request: Request,
  bucket: string,
  limit: number,
  windowMs: number,
): Promise<NextResponse | null> {
  const ip = clientIpFromHeaders(request.headers);
  const result = await checkRateLimit(`${bucket}:${ip}`, limit, windowMs);
  if (!result.allowed) {
    return jsonError(
      429,
      "RATE_LIMITED",
      "Túl sok kérés érkezett. Kérjük, próbáld újra néhány perc múlva.",
      { retryAfterMs: result.retryAfterMs },
    );
  }
  return null;
}
