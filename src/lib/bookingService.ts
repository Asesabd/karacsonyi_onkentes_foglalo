import { EventDay, Prisma, SeatStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generateLockToken, generatePublicId } from "@/lib/publicId";
import { ALL_DAYS, LOCK_DURATION_MS } from "@/lib/config";

export class LockUnavailableError extends Error {
  constructor(public readonly unavailable: { day: EventDay; seatNumber: number }[]) {
    super("One or more requested seats are no longer available");
    this.name = "LockUnavailableError";
  }
}

export class LockExpiredError extends Error {
  constructor() {
    super("Lock is missing, expired, or was already used");
    this.name = "LockExpiredError";
  }
}

interface SeatRow {
  id: string;
  day: EventDay;
  seatNumber: number;
  status: SeatStatus;
  lockedUntil: Date | null;
}

export interface DaySelection {
  day: EventDay;
  seatNumbers: number[];
}

export interface LockResult {
  lockToken: string;
  expiresAt: Date;
  seats: { day: EventDay; seatNumber: number }[];
}

/**
 * Publicly-safe seat status - never exposes who booked a seat, only whether
 * it can currently be selected.
 */
export interface PublicSeatStatus {
  seatNumber: number;
  status: "FREE" | "LOCKED" | "BOOKED";
}

/**
 * Lazily flips expired locks back to FREE. Safe to call concurrently: each
 * row transition is a single guarded UPDATE, and it is also re-checked
 * (with a row lock) inside createLock/finalizeBooking regardless, so this
 * sweep is purely a display/consistency convenience, not a correctness
 * requirement.
 */
export async function releaseExpiredLocks(): Promise<void> {
  await prisma.seat.updateMany({
    where: { status: SeatStatus.LOCKED, lockedUntil: { lt: new Date() } },
    data: { status: SeatStatus.FREE, lockToken: null, lockedUntil: null },
  });
}

export async function getSeatMapForDay(day: EventDay): Promise<PublicSeatStatus[]> {
  await releaseExpiredLocks();
  const seats = await prisma.seat.findMany({
    where: { day },
    orderBy: { seatNumber: "asc" },
    select: { seatNumber: true, status: true },
  });
  return seats.map((s) => ({ seatNumber: s.seatNumber, status: s.status }));
}

export async function getAllSeatMaps(): Promise<Record<EventDay, PublicSeatStatus[]>> {
  await releaseExpiredLocks();
  const seats = await prisma.seat.findMany({
    orderBy: [{ day: "asc" }, { seatNumber: "asc" }],
    select: { day: true, seatNumber: true, status: true },
  });
  const result = { DEC_24: [], DEC_25: [], DEC_26: [] } as Record<EventDay, PublicSeatStatus[]>;
  for (const seat of seats) {
    result[seat.day].push({ seatNumber: seat.seatNumber, status: seat.status });
  }
  return result;
}

/**
 * Atomically locks every requested seat for LOCK_DURATION_MS, or none at
 * all. Uses `SELECT ... FOR UPDATE` inside a transaction so that under
 * concurrent requests for overlapping seats, Postgres serializes access to
 * those rows: the loser's view of `status` is guaranteed fresh (not a
 * stale read), so only one caller ever sees a seat as available.
 *
 * Days are always processed in a fixed order (ALL_DAYS) and seat numbers
 * ascending within a day, so two transactions requesting overlapping seats
 * always try to acquire row locks in the same order - this avoids
 * deadlocks under concurrency instead of relying on Postgres's deadlock
 * detector.
 */
export async function createLock(selections: DaySelection[]): Promise<LockResult> {
  const lockToken = generateLockToken();
  const expiresAt = new Date(Date.now() + LOCK_DURATION_MS);
  const now = new Date();

  const byDay = new Map<EventDay, number[]>();
  for (const sel of selections) {
    byDay.set(sel.day, [...(byDay.get(sel.day) ?? []), ...sel.seatNumbers].sort((a, b) => a - b));
  }
  const orderedDays = ALL_DAYS.filter((d) => byDay.has(d));

  return prisma.$transaction(async (tx) => {
    const allRows: SeatRow[] = [];

    for (const day of orderedDays) {
      const seatNumbers = byDay.get(day) as number[];
      const rows = await tx.$queryRaw<SeatRow[]>`
        SELECT id, day, "seatNumber", status, "lockedUntil"
        FROM "Seat"
        WHERE day = ${day}::"EventDay" AND "seatNumber" = ANY(${seatNumbers})
        ORDER BY "seatNumber"
        FOR UPDATE
      `;
      allRows.push(...rows);
    }

    const requestedCount = orderedDays.reduce((sum, d) => sum + (byDay.get(d)?.length ?? 0), 0);
    if (allRows.length !== requestedCount) {
      // Should not happen since all 150 seats are pre-seeded, but guard anyway.
      throw new LockUnavailableError(
        orderedDays.flatMap((day) => (byDay.get(day) ?? []).map((seatNumber) => ({ day, seatNumber }))),
      );
    }

    const unavailable = allRows.filter(
      (r) => !(r.status === SeatStatus.FREE || (r.status === SeatStatus.LOCKED && (!r.lockedUntil || r.lockedUntil < now))),
    );
    if (unavailable.length > 0) {
      throw new LockUnavailableError(unavailable.map((r) => ({ day: r.day, seatNumber: r.seatNumber })));
    }

    const ids = allRows.map((r) => r.id);
    await tx.seat.updateMany({
      where: { id: { in: ids } },
      data: { status: SeatStatus.LOCKED, lockedUntil: expiresAt, lockToken, bookingId: null },
    });

    return {
      lockToken,
      expiresAt,
      seats: allRows.map((r) => ({ day: r.day, seatNumber: r.seatNumber })),
    };
  });
}

/** Releases a lock early (e.g. user navigates away/cancels before the 10 minutes are up). */
export async function releaseLock(lockToken: string): Promise<void> {
  await prisma.seat.updateMany({
    where: { lockToken, status: SeatStatus.LOCKED },
    data: { status: SeatStatus.FREE, lockToken: null, lockedUntil: null },
  });
}

export interface FinalizeBookingInput {
  lockToken: string;
  name: string;
  email: string;
  phone: string;
}

type BookingWithSeats = Prisma.BookingGetPayload<{ include: { seats: true } }>;

export type FinalizeBookingResult =
  | { ok: true; booking: BookingWithSeats; alreadyExisted: boolean }
  | { ok: false; reason: "LOCK_EXPIRED" };

const MAX_PUBLIC_ID_ATTEMPTS = 5;

function isUniqueConstraintOn(err: unknown, target: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    Array.isArray(err.meta?.target) &&
    (err.meta?.target as string[]).includes(target)
  );
}

/**
 * Turns a lock into a confirmed booking. This is the function that must
 * never allow two bookings for the same seat: the `SELECT ... FOR UPDATE`
 * takes a row lock on every seat carrying this lock token, so a concurrent
 * caller (e.g. a retried request, or - impossible in practice, since the
 * token is secret and random, but guarded anyway - a colliding token) has
 * to wait for this transaction to fully commit or roll back before it can
 * even read the seats' current state.
 *
 * Idempotent: the lock token is stored as the booking's unique
 * `idempotencyKey`, so calling this twice with the same token (double
 * click, client retry after a network blip) returns the same booking
 * instead of creating a duplicate.
 */
export async function finalizeBooking(input: FinalizeBookingInput): Promise<FinalizeBookingResult> {
  const existing = await prisma.booking.findUnique({
    where: { idempotencyKey: input.lockToken },
    include: { seats: true },
  });
  if (existing) {
    return { ok: true, booking: existing, alreadyExisted: true };
  }

  for (let attempt = 0; attempt < MAX_PUBLIC_ID_ATTEMPTS; attempt++) {
    try {
      const booking = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<SeatRow[]>`
          SELECT id, day, "seatNumber", status, "lockedUntil"
          FROM "Seat"
          WHERE "lockToken" = ${input.lockToken}
          ORDER BY day, "seatNumber"
          FOR UPDATE
        `;

        const now = new Date();
        const valid =
          rows.length > 0 &&
          rows.every((r) => r.status === SeatStatus.LOCKED && r.lockedUntil && r.lockedUntil > now);

        if (!valid) {
          throw new LockExpiredError();
        }

        const publicId = generatePublicId();
        const created = await tx.booking.create({
          data: {
            publicId,
            idempotencyKey: input.lockToken,
            name: input.name,
            email: input.email,
            phone: input.phone,
          },
        });

        const updated = await tx.seat.updateMany({
          where: { lockToken: input.lockToken, status: SeatStatus.LOCKED },
          data: {
            status: SeatStatus.BOOKED,
            bookingId: created.id,
            lockToken: null,
            lockedUntil: null,
          },
        });

        if (updated.count !== rows.length) {
          throw new LockExpiredError();
        }

        return tx.booking.findUniqueOrThrow({ where: { id: created.id }, include: { seats: true } });
      });

      return { ok: true, booking, alreadyExisted: false };
    } catch (err) {
      if (err instanceof LockExpiredError) {
        // The seat's lockToken may have just been cleared by a concurrent
        // call with this exact same token (e.g. a double-submitted form) -
        // that caller already created the booking, it's not really a
        // stale/expired lock from this request's point of view. Check
        // before reporting failure, so retries stay idempotent instead of
        // surfacing a spurious error to a user who already succeeded.
        const race = await prisma.booking.findUnique({
          where: { idempotencyKey: input.lockToken },
          include: { seats: true },
        });
        if (race) return { ok: true, booking: race, alreadyExisted: true };
        return { ok: false, reason: "LOCK_EXPIRED" };
      }
      if (isUniqueConstraintOn(err, "publicId")) {
        continue; // extremely unlikely collision - retry with a fresh id
      }
      if (isUniqueConstraintOn(err, "idempotencyKey")) {
        const race = await prisma.booking.findUnique({
          where: { idempotencyKey: input.lockToken },
          include: { seats: true },
        });
        if (race) return { ok: true, booking: race, alreadyExisted: true };
      }
      throw err;
    }
  }

  throw new Error("Failed to generate a unique booking id after several attempts");
}

export type DeleteBookingResult = { ok: true } | { ok: false; reason: "NOT_FOUND" };

/**
 * Deletes a booking and frees its seats back to FREE in one transaction, so
 * an admin never ends up with seats stuck as BOOKED with no owning booking,
 * or a booking that still holds seats it no longer owns.
 */
export async function deleteBooking(bookingId: string): Promise<DeleteBookingResult> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  await prisma.$transaction([
    prisma.seat.updateMany({
      where: { bookingId },
      data: { status: SeatStatus.FREE, bookingId: null, lockToken: null, lockedUntil: null },
    }),
    prisma.booking.delete({ where: { id: bookingId } }),
  ]);

  return { ok: true };
}
