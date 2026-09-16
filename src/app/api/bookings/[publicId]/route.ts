import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enforceRateLimit, jsonError } from "@/lib/apiHelpers";

// Public but only useful if you already know the (non-guessable, random)
// publicId - this is how the confirmation page re-fetches its own booking
// after a refresh, without exposing a listing of anyone else's data. Rate
// limited so brute-forcing ids (32^6 possibilities - impractical, but still)
// is not free.
export async function GET(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const rateLimited = await enforceRateLimit(request, "lookup-booking", 30, 60_000);
  if (rateLimited) return rateLimited;

  const { publicId } = await params;

  if (!/^XMAS-[A-Z0-9]{6}$/.test(publicId)) {
    return jsonError(404, "NOT_FOUND", "A foglalás nem található.");
  }

  const booking = await prisma.booking.findUnique({
    where: { publicId },
    include: { seats: true },
  });

  if (!booking) {
    return jsonError(404, "NOT_FOUND", "A foglalás nem található.");
  }

  return NextResponse.json({
    publicId: booking.publicId,
    name: booking.name,
    email: booking.email,
    createdAt: booking.createdAt.toISOString(),
    seats: booking.seats.map((s) => ({ day: s.day, seatNumber: s.seatNumber })),
  });
}
