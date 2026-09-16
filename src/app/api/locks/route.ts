import { NextResponse } from "next/server";
import { createLockSchema } from "@/lib/validation";
import { createLock, LockUnavailableError, releaseLock } from "@/lib/bookingService";
import { DAY_INFO } from "@/lib/config";
import { enforceRateLimit, enforceSameOrigin, jsonError } from "@/lib/apiHelpers";

export async function POST(request: Request) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;

  const rateLimited = await enforceRateLimit(request, "create-lock", 20, 60_000);
  if (rateLimited) return rateLimited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "INVALID_JSON", "Érvénytelen kérés formátum.");
  }

  const parsed = createLockSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_ERROR", "Érvénytelen adatok.", {
      issues: parsed.error.issues.map((i) => i.message),
    });
  }

  if (parsed.data.website) {
    // Honeypot tripped - pretend success is unnecessary here since this is a
    // same-origin API; just reject quietly.
    return jsonError(400, "VALIDATION_ERROR", "Érvénytelen kérés.");
  }

  try {
    const result = await createLock(parsed.data.selections);
    return NextResponse.json({
      lockToken: result.lockToken,
      expiresAt: result.expiresAt.toISOString(),
      seats: result.seats,
    });
  } catch (err) {
    if (err instanceof LockUnavailableError) {
      return jsonError(
        409,
        "SEATS_UNAVAILABLE",
        "Egy vagy több kiválasztott helyet időközben más lefoglalt vagy zárolt. Kérjük, válassz másik szabad helyet.",
        {
          unavailable: err.unavailable.map((u) => ({
            day: u.day,
            seatNumber: u.seatNumber,
            dayLabel: DAY_INFO[u.day].label,
          })),
        },
      );
    }
    throw err;
  }
}

export async function DELETE(request: Request) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "INVALID_JSON", "Érvénytelen kérés formátum.");
  }

  const lockToken = typeof (body as { lockToken?: unknown })?.lockToken === "string"
    ? (body as { lockToken: string }).lockToken
    : null;

  if (!lockToken) {
    return jsonError(400, "VALIDATION_ERROR", "Hiányzó lockToken.");
  }

  await releaseLock(lockToken);
  return NextResponse.json({ ok: true });
}
