import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { EmailStatus } from "@prisma/client";
import { sendBookingConfirmationEmailWithRetries } from "@/lib/email";
import { jsonError } from "@/lib/apiHelpers";

const MAX_EMAIL_ATTEMPTS = 8;

// Intended to be hit by a platform cron (e.g. every 5-10 minutes) to retry
// confirmation emails that failed right after booking. A booking is never
// re-created here - only its emailStatus/emailAttempts are updated - so
// this is safe to run repeatedly and concurrently with normal traffic.
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return jsonError(401, "UNAUTHORIZED", "Unauthorized.");
  }

  const pending = await prisma.booking.findMany({
    where: { emailStatus: EmailStatus.FAILED, emailAttempts: { lt: MAX_EMAIL_ATTEMPTS } },
    include: { seats: true },
    take: 50,
  });

  const results = [];
  for (const booking of pending) {
    const result = await sendBookingConfirmationEmailWithRetries(booking);
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        emailStatus: result.ok ? EmailStatus.SENT : EmailStatus.FAILED,
        emailAttempts: { increment: 1 },
        emailLastError: result.ok ? null : result.error.slice(0, 500),
      },
    });
    results.push({ publicId: booking.publicId, ok: result.ok });
  }

  return NextResponse.json({ processed: results.length, results });
}
