import { NextResponse } from "next/server";
import { finalizeBookingSchema } from "@/lib/validation";
import { finalizeBooking } from "@/lib/bookingService";
import { sendBookingConfirmationEmailOnce } from "@/lib/email";
import { prisma } from "@/lib/db";
import { EmailStatus } from "@prisma/client";
import { enforceRateLimit, enforceSameOrigin, jsonError } from "@/lib/apiHelpers";

export async function POST(request: Request) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;

  const rateLimited = await enforceRateLimit(request, "finalize-booking", 10, 60_000);
  if (rateLimited) return rateLimited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "INVALID_JSON", "Érvénytelen kérés formátum.");
  }

  const parsed = finalizeBookingSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_ERROR", "Kérjük, ellenőrizd a megadott adatokat.", {
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }

  if (parsed.data.website) {
    return jsonError(400, "VALIDATION_ERROR", "Érvénytelen kérés.");
  }

  // Very fast submits are a common bot signal - a real user needs at least
  // a couple of seconds to read the summary and fill in contact details.
  if (parsed.data.formRenderedAt && Date.now() - parsed.data.formRenderedAt < 1500) {
    return jsonError(400, "VALIDATION_ERROR", "Érvénytelen kérés.");
  }

  const result = await finalizeBooking({
    lockToken: parsed.data.lockToken,
    name: parsed.data.name,
    email: parsed.data.email,
    phone: parsed.data.phone,
  });

  if (!result.ok) {
    return jsonError(
      409,
      "LOCK_EXPIRED",
      "A 10 perces foglalási idő lejárt, vagy a foglalás már nem érvényes. Kérjük, válaszd ki újra a helyeket.",
    );
  }

  if (!result.alreadyExisted) {
    const emailResult = await sendBookingConfirmationEmailOnce(result.booking);
    await prisma.booking.update({
      where: { id: result.booking.id },
      data: {
        emailStatus: emailResult.ok ? EmailStatus.SENT : EmailStatus.FAILED,
        emailAttempts: { increment: 1 },
        emailLastError: emailResult.ok ? null : emailResult.error.slice(0, 500),
      },
    });
  }

  return NextResponse.json({
    publicId: result.booking.publicId,
    name: result.booking.name,
    email: result.booking.email,
    seats: result.booking.seats.map((s) => ({ day: s.day, seatNumber: s.seatNumber })),
  });
}
