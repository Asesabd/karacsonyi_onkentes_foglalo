import { prisma } from "@/lib/db";
import { EventDay, SeatStatus } from "@prisma/client";

export const ALL_TEST_DAYS: EventDay[] = [EventDay.DEC_24, EventDay.DEC_25, EventDay.DEC_26];
export const TEST_SEATS_PER_DAY = 50;

/** Resets every seat to FREE and wipes all bookings, re-seeding if the table is empty. */
export async function resetDb(): Promise<void> {
  await prisma.booking.deleteMany();
  await prisma.rateLimit.deleteMany();

  const seatCount = await prisma.seat.count();
  if (seatCount === 0) {
    for (const day of ALL_TEST_DAYS) {
      for (let seatNumber = 1; seatNumber <= TEST_SEATS_PER_DAY; seatNumber++) {
        await prisma.seat.create({ data: { day, seatNumber } });
      }
    }
  } else {
    await prisma.seat.updateMany({
      data: { status: SeatStatus.FREE, lockToken: null, lockedUntil: null, bookingId: null },
    });
  }
}
