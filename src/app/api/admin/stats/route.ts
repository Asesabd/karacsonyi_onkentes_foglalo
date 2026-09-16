import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { releaseExpiredLocks } from "@/lib/bookingService";
import { ALL_DAYS, DAY_INFO, SEATS_PER_DAY } from "@/lib/config";
import { SeatStatus } from "@prisma/client";

export async function GET() {
  await releaseExpiredLocks();

  const seats = await prisma.seat.groupBy({
    by: ["day", "status"],
    _count: { _all: true },
  });

  const stats = ALL_DAYS.map((day) => {
    const booked = seats.find((s) => s.day === day && s.status === SeatStatus.BOOKED)?._count._all ?? 0;
    const locked = seats.find((s) => s.day === day && s.status === SeatStatus.LOCKED)?._count._all ?? 0;
    const free = SEATS_PER_DAY - booked - locked;
    return { day, label: DAY_INFO[day].label, total: SEATS_PER_DAY, booked, locked, free };
  });

  const totalBookings = await prisma.booking.count();

  return NextResponse.json({ stats, totalBookings }, { headers: { "Cache-Control": "no-store" } });
}
