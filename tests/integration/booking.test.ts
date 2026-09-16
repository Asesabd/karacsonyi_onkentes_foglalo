import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { EventDay, SeatStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  createLock,
  finalizeBooking,
  releaseExpiredLocks,
  releaseLock,
  deleteBooking,
  LockUnavailableError,
  getSeatMapForDay,
} from "@/lib/bookingService";
import { resetDb } from "../testUtils";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe("normal booking flow", () => {
  it("locks a single seat and finalizes a booking", async () => {
    const lock = await createLock([{ day: EventDay.DEC_24, seatNumbers: [10] }]);
    expect(lock.seats).toEqual([{ day: EventDay.DEC_24, seatNumber: 10 }]);

    const seat = await prisma.seat.findUniqueOrThrow({ where: { day_seatNumber: { day: EventDay.DEC_24, seatNumber: 10 } } });
    expect(seat.status).toBe(SeatStatus.LOCKED);
    expect(seat.lockToken).toBe(lock.lockToken);

    const result = await finalizeBooking({
      lockToken: lock.lockToken,
      name: "Kovács Anna",
      email: "anna@example.com",
      phone: "+36301234567",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.booking.publicId).toMatch(/^XMAS-[A-Z0-9]{6}$/);
    expect(result.booking.seats).toHaveLength(1);

    const bookedSeat = await prisma.seat.findUniqueOrThrow({
      where: { day_seatNumber: { day: EventDay.DEC_24, seatNumber: 10 } },
    });
    expect(bookedSeat.status).toBe(SeatStatus.BOOKED);
    expect(bookedSeat.bookingId).toBe(result.booking.id);
    expect(bookedSeat.lockToken).toBeNull();
  });

  it("books multiple seats on one day in a single request", async () => {
    const lock = await createLock([{ day: EventDay.DEC_25, seatNumbers: [1, 2, 3] }]);
    const result = await finalizeBooking({
      lockToken: lock.lockToken,
      name: "Teszt Elek",
      email: "elek@example.com",
      phone: "06301234567",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.booking.seats).toHaveLength(3);

    const seats = await getSeatMapForDay(EventDay.DEC_25);
    const booked = seats.filter((s) => [1, 2, 3].includes(s.seatNumber));
    expect(booked.every((s) => s.status === "BOOKED")).toBe(true);
  });

  it("books seats across multiple days in a single request", async () => {
    const lock = await createLock([
      { day: EventDay.DEC_24, seatNumbers: [20, 21] },
      { day: EventDay.DEC_25, seatNumbers: [30] },
      { day: EventDay.DEC_26, seatNumbers: [1] },
    ]);
    const result = await finalizeBooking({
      lockToken: lock.lockToken,
      name: "Multi Napos",
      email: "multi@example.com",
      phone: "+36701112233",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.booking.seats).toHaveLength(4);

    const dayCounts = new Map<string, number>();
    for (const s of result.booking.seats) {
      dayCounts.set(s.day, (dayCounts.get(s.day) ?? 0) + 1);
    }
    expect(dayCounts.get(EventDay.DEC_24)).toBe(2);
    expect(dayCounts.get(EventDay.DEC_25)).toBe(1);
    expect(dayCounts.get(EventDay.DEC_26)).toBe(1);
  });
});

describe("lock lifecycle", () => {
  it("sets lockedUntil roughly 10 minutes in the future", async () => {
    const before = Date.now();
    const lock = await createLock([{ day: EventDay.DEC_24, seatNumbers: [7] }]);
    const expiresInMs = new Date(lock.expiresAt).getTime() - before;
    expect(expiresInMs).toBeGreaterThan(9 * 60 * 1000);
    expect(expiresInMs).toBeLessThanOrEqual(10 * 60 * 1000 + 2000);
  });

  it("treats an expired lock as available again for a new lock", async () => {
    const lock = await createLock([{ day: EventDay.DEC_24, seatNumbers: [8] }]);
    // Simulate time passing: force the lock into the past.
    await prisma.seat.update({
      where: { day_seatNumber: { day: EventDay.DEC_24, seatNumber: 8 } },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });

    const secondLock = await createLock([{ day: EventDay.DEC_24, seatNumbers: [8] }]);
    expect(secondLock.lockToken).not.toBe(lock.lockToken);

    const seat = await prisma.seat.findUniqueOrThrow({ where: { day_seatNumber: { day: EventDay.DEC_24, seatNumber: 8 } } });
    expect(seat.lockToken).toBe(secondLock.lockToken);
  });

  it("rejects finalizing a booking after the lock expired", async () => {
    const lock = await createLock([{ day: EventDay.DEC_24, seatNumbers: [9] }]);
    await prisma.seat.update({
      where: { day_seatNumber: { day: EventDay.DEC_24, seatNumber: 9 } },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });

    const result = await finalizeBooking({
      lockToken: lock.lockToken,
      name: "Kesett Kata",
      email: "kata@example.com",
      phone: "+36301112233",
    });
    expect(result.ok).toBe(false);

    const seat = await prisma.seat.findUniqueOrThrow({ where: { day_seatNumber: { day: EventDay.DEC_24, seatNumber: 9 } } });
    expect(seat.status).toBe(SeatStatus.LOCKED); // untouched, still expired-but-LOCKED until swept
  });

  it("releaseExpiredLocks flips expired locks back to FREE", async () => {
    await createLock([{ day: EventDay.DEC_26, seatNumbers: [15] }]);
    await prisma.seat.update({
      where: { day_seatNumber: { day: EventDay.DEC_26, seatNumber: 15 } },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });

    await releaseExpiredLocks();

    const seat = await prisma.seat.findUniqueOrThrow({ where: { day_seatNumber: { day: EventDay.DEC_26, seatNumber: 15 } } });
    expect(seat.status).toBe(SeatStatus.FREE);
    expect(seat.lockToken).toBeNull();
  });

  it("releaseLock frees a seat before its natural expiry", async () => {
    const lock = await createLock([{ day: EventDay.DEC_24, seatNumbers: [11] }]);
    await releaseLock(lock.lockToken);

    const seat = await prisma.seat.findUniqueOrThrow({ where: { day_seatNumber: { day: EventDay.DEC_24, seatNumber: 11 } } });
    expect(seat.status).toBe(SeatStatus.FREE);
  });
});

describe("double-booking prevention", () => {
  it("refuses to lock an already-booked seat", async () => {
    const lock = await createLock([{ day: EventDay.DEC_24, seatNumbers: [13] }]);
    await finalizeBooking({ lockToken: lock.lockToken, name: "A", email: "a@example.com", phone: "+36301234567" });

    await expect(createLock([{ day: EventDay.DEC_24, seatNumbers: [13] }])).rejects.toBeInstanceOf(LockUnavailableError);
  });

  it("refuses to lock a seat someone else currently holds", async () => {
    await createLock([{ day: EventDay.DEC_24, seatNumbers: [14] }]);
    await expect(createLock([{ day: EventDay.DEC_24, seatNumbers: [14] }])).rejects.toBeInstanceOf(LockUnavailableError);
  });

  it("rolls back the whole request when only one seat in a multi-seat selection is unavailable", async () => {
    await createLock([{ day: EventDay.DEC_24, seatNumbers: [40] }]);

    await expect(createLock([{ day: EventDay.DEC_24, seatNumbers: [39, 40, 41] }])).rejects.toBeInstanceOf(
      LockUnavailableError,
    );

    // 39 and 41 must still be FREE - an "all or nothing" lock never
    // partially succeeds.
    const seat39 = await prisma.seat.findUniqueOrThrow({ where: { day_seatNumber: { day: EventDay.DEC_24, seatNumber: 39 } } });
    const seat41 = await prisma.seat.findUniqueOrThrow({ where: { day_seatNumber: { day: EventDay.DEC_24, seatNumber: 41 } } });
    expect(seat39.status).toBe(SeatStatus.FREE);
    expect(seat41.status).toBe(SeatStatus.FREE);
  });

  it("under many concurrent requests for the same seat, exactly one succeeds", async () => {
    const CONCURRENT = 25;
    const attempts = await Promise.allSettled(
      Array.from({ length: CONCURRENT }, () => createLock([{ day: EventDay.DEC_25, seatNumbers: [25] }])),
    );

    const succeeded = attempts.filter((a) => a.status === "fulfilled");
    const failed = attempts.filter((a) => a.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(CONCURRENT - 1);
    for (const f of failed) {
      if (f.status === "rejected") {
        expect(f.reason).toBeInstanceOf(LockUnavailableError);
      }
    }

    const seat = await prisma.seat.findUniqueOrThrow({ where: { day_seatNumber: { day: EventDay.DEC_25, seatNumber: 25 } } });
    expect(seat.status).toBe(SeatStatus.LOCKED);
  });

  it("under many concurrent finalize calls racing to book the same locked seat with a shared token, no duplicate bookings are created", async () => {
    const lock = await createLock([{ day: EventDay.DEC_26, seatNumbers: [33] }]);
    const CONCURRENT = 15;

    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        finalizeBooking({
          lockToken: lock.lockToken,
          name: "Race Test",
          email: "race@example.com",
          phone: "+36301234567",
        }),
      ),
    );

    const successes = results.filter((r) => r.ok);
    expect(successes.length).toBe(CONCURRENT); // idempotent: same token, all "succeed" with the same booking

    const publicIds = new Set(successes.map((r) => (r.ok ? r.booking.publicId : null)));
    expect(publicIds.size).toBe(1); // but only one underlying booking exists

    const bookingCount = await prisma.booking.count();
    expect(bookingCount).toBe(1);

    const seat = await prisma.seat.findUniqueOrThrow({ where: { day_seatNumber: { day: EventDay.DEC_26, seatNumber: 33 } } });
    expect(seat.status).toBe(SeatStatus.BOOKED);
  });

  it("proves the same day+seat combination is never booked twice under a full contention race (create-lock stage)", async () => {
    const CONCURRENT = 40;
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT }, (_, i) =>
        (async () => {
          const lock = await createLock([{ day: EventDay.DEC_24, seatNumbers: [42] }]);
          return finalizeBooking({
            lockToken: lock.lockToken,
            name: `Bidder ${i}`,
            email: `bidder${i}@example.com`,
            phone: "+36301234567",
          });
        })(),
      ),
    );

    const successfulBookings = results.filter((r) => r.status === "fulfilled" && r.value.ok);
    expect(successfulBookings).toHaveLength(1);

    const seat = await prisma.seat.findUniqueOrThrow({ where: { day_seatNumber: { day: EventDay.DEC_24, seatNumber: 42 } } });
    expect(seat.status).toBe(SeatStatus.BOOKED);

    const bookingsForThisSeat = await prisma.booking.count({
      where: { seats: { some: { day: EventDay.DEC_24, seatNumber: 42 } } },
    });
    expect(bookingsForThisSeat).toBe(1);
  });
});

describe("invalid input handling", () => {
  it("finalizeBooking rejects an unknown lock token", async () => {
    const result = await finalizeBooking({
      lockToken: "does-not-exist-token",
      name: "Ismeretlen",
      email: "ismeretlen@example.com",
      phone: "+36301234567",
    });
    expect(result.ok).toBe(false);
  });
});

describe("admin: delete booking", () => {
  it("frees the seats and removes the booking", async () => {
    const lock = await createLock([{ day: EventDay.DEC_25, seatNumbers: [44, 45] }]);
    const result = await finalizeBooking({
      lockToken: lock.lockToken,
      name: "Torlendo Tibor",
      email: "tibor@example.com",
      phone: "+36301234567",
    });
    if (!result.ok) throw new Error("expected success");

    const deleteResult = await deleteBooking(result.booking.id);
    expect(deleteResult.ok).toBe(true);

    const bookingStillExists = await prisma.booking.findUnique({ where: { id: result.booking.id } });
    expect(bookingStillExists).toBeNull();

    const seat44 = await prisma.seat.findUniqueOrThrow({ where: { day_seatNumber: { day: EventDay.DEC_25, seatNumber: 44 } } });
    const seat45 = await prisma.seat.findUniqueOrThrow({ where: { day_seatNumber: { day: EventDay.DEC_25, seatNumber: 45 } } });
    expect(seat44.status).toBe(SeatStatus.FREE);
    expect(seat45.status).toBe(SeatStatus.FREE);
    expect(seat44.bookingId).toBeNull();
  });

  it("reports NOT_FOUND for an unknown booking id", async () => {
    const result = await deleteBooking("nonexistent-id");
    expect(result.ok).toBe(false);
  });

  it("lets the freed seat be booked again after deletion", async () => {
    const lock = await createLock([{ day: EventDay.DEC_24, seatNumbers: [46] }]);
    const first = await finalizeBooking({
      lockToken: lock.lockToken,
      name: "Elso",
      email: "elso@example.com",
      phone: "+36301234567",
    });
    if (!first.ok) throw new Error("expected success");
    await deleteBooking(first.booking.id);

    const secondLock = await createLock([{ day: EventDay.DEC_24, seatNumbers: [46] }]);
    const second = await finalizeBooking({
      lockToken: secondLock.lockToken,
      name: "Masodik",
      email: "masodik@example.com",
      phone: "+36301234567",
    });
    expect(second.ok).toBe(true);
  });
});
