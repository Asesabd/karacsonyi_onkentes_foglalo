import { prisma } from "@/lib/db";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Fixed-window rate limiter backed by a single Postgres row per key.
 *
 * The INSERT ... ON CONFLICT ... DO UPDATE is a single atomic statement, so
 * concurrent requests sharing the same key still get a correct count instead
 * of racing on a read-then-write - the same pattern used for seat locking,
 * just for a counter instead of a status. Good enough at this scale (~300
 * concurrent users) without adding a Redis dependency.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const rows = await prisma.$queryRaw<{ count: number; window_start: Date }[]>`
    INSERT INTO "RateLimit" (key, "windowStart", count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN "RateLimit"."windowStart" < now() - (${windowMs}::float || ' milliseconds')::interval
          THEN 1
        ELSE "RateLimit".count + 1
      END,
      "windowStart" = CASE
        WHEN "RateLimit"."windowStart" < now() - (${windowMs}::float || ' milliseconds')::interval
          THEN now()
        ELSE "RateLimit"."windowStart"
      END
    RETURNING count, "windowStart" AS window_start
  `;

  const row = rows[0];
  if (!row) {
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }

  const elapsed = Date.now() - new Date(row.window_start).getTime();
  const retryAfterMs = Math.max(0, windowMs - elapsed);

  return {
    allowed: row.count <= limit,
    remaining: Math.max(0, limit - row.count),
    retryAfterMs,
  };
}

export function clientIpFromHeaders(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? "unknown";
  }
  return headers.get("x-real-ip") ?? "unknown";
}
