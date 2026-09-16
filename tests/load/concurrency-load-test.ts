/**
 * Concurrency / load test against a *running* server (npm run build && npm run start,
 * or npm run dev). Not part of the vitest suite - run separately with:
 *
 *   npm run test:load
 *   BASE_URL=https://staging.example.com npm run test:load
 *
 * What it proves, per the spec's requirement in section 17/18: simulate ~300
 * concurrent clients, including many racing for the exact same last-remaining
 * seats, and show afterwards that no (day, seatNumber) combination was ever
 * booked twice.
 */
import { EventDay } from "@prisma/client";
import { prisma } from "../../src/lib/db";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

interface AttemptOutcome {
  kind: "booked" | "conflict" | "error";
  detail?: string;
}

async function resetDb() {
  await prisma.booking.deleteMany();
  await prisma.rateLimit.deleteMany();
  await prisma.seat.updateMany({
    data: { status: "FREE", lockToken: null, lockedUntil: null, bookingId: null },
  });
  console.log("Database reset to a clean state (150 free seats, 0 bookings).");
}

async function attemptBooking(day: EventDay, seatNumbers: number[], clientIp: string): Promise<AttemptOutcome> {
  try {
    const lockRes = await fetch(`${BASE_URL}/api/locks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": clientIp },
      body: JSON.stringify({ selections: [{ day, seatNumbers }], website: "" }),
    });

    if (lockRes.status === 409) return { kind: "conflict", detail: "seat unavailable at lock time" };
    if (!lockRes.ok) return { kind: "error", detail: `lock HTTP ${lockRes.status}` };

    const lock = (await lockRes.json()) as { lockToken: string };

    const bookRes = await fetch(`${BASE_URL}/api/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": clientIp },
      body: JSON.stringify({
        lockToken: lock.lockToken,
        name: `Load Test ${clientIp}`,
        email: `loadtest-${clientIp.replace(/\./g, "-")}@example.com`,
        phone: "+36301234567",
        website: "",
        formRenderedAt: Date.now() - 5000,
      }),
    });

    if (bookRes.status === 409) return { kind: "conflict", detail: "lock expired/stolen at finalize time" };
    if (!bookRes.ok) return { kind: "error", detail: `finalize HTTP ${bookRes.status}` };

    return { kind: "booked" };
  } catch (err) {
    return { kind: "error", detail: err instanceof Error ? err.message : String(err) };
  }
}

function fakeIp(i: number): string {
  const a = 10;
  const b = Math.floor(i / 65536) % 256;
  const c = Math.floor(i / 256) % 256;
  const d = i % 256;
  return `${a}.${b}.${c}.${d}`;
}

function summarize(outcomes: AttemptOutcome[]) {
  const booked = outcomes.filter((o) => o.kind === "booked").length;
  const conflict = outcomes.filter((o) => o.kind === "conflict").length;
  const error = outcomes.filter((o) => o.kind === "error").length;
  return { total: outcomes.length, booked, conflict, error };
}

async function assertNoDoubleBookings() {
  const seats = await prisma.seat.findMany({ where: { status: "BOOKED" } });
  const seen = new Map<string, number>();
  for (const s of seats) {
    const key = `${s.day}#${s.seatNumber}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const duplicates = Array.from(seen.entries()).filter(([, count]) => count > 1);
  if (duplicates.length > 0) {
    throw new Error(`DOUBLE BOOKING DETECTED for: ${duplicates.map(([k]) => k).join(", ")}`);
  }

  // Cross-check from the Booking side too: every seat a booking claims must
  // itself be BOOKED and point back at that exact booking (no orphaned or
  // mismatched links).
  const bookings = await prisma.booking.findMany({ include: { seats: true } });
  const claimCounts = new Map<string, number>();
  for (const b of bookings) {
    for (const s of b.seats) {
      const key = `${s.day}#${s.seatNumber}`;
      claimCounts.set(key, (claimCounts.get(key) ?? 0) + 1);
      if (s.status !== "BOOKED" || s.bookingId !== b.id) {
        throw new Error(`Inconsistent seat/booking link for ${key} (booking ${b.publicId})`);
      }
    }
  }
  const claimedTwice = Array.from(claimCounts.entries()).filter(([, count]) => count > 1);
  if (claimedTwice.length > 0) {
    throw new Error(`Seat claimed by more than one booking: ${claimedTwice.map(([k]) => k).join(", ")}`);
  }

  console.log(`Verified: ${seats.length} BOOKED seats, ${bookings.length} bookings, zero double-bookings.`);
}

async function phaseGeneralLoad() {
  console.log("\n=== Phase 1: general load - 300 concurrent clients, random day + 1-3 seats each ===");
  const days = [EventDay.DEC_24, EventDay.DEC_25, EventDay.DEC_26];
  const CLIENTS = 300;

  const start = Date.now();
  const outcomes = await Promise.all(
    Array.from({ length: CLIENTS }, (_, i) => {
      const day = days[i % 3] as EventDay;
      const seatCount = 1 + (i % 3);
      // Deliberately overlapping ranges across clients on the same day so
      // several clients fight over the same seat numbers.
      const base = 1 + (i % 15);
      const seatNumbers = Array.from({ length: seatCount }, (_, k) => ((base + k - 1) % 50) + 1);
      return attemptBooking(day, [...new Set(seatNumbers)], fakeIp(i));
    }),
  );
  const durationMs = Date.now() - start;

  const stats = summarize(outcomes);
  console.log(`Done in ${durationMs}ms:`, stats);
  return stats;
}

async function phaseLastSeatsRush() {
  console.log("\n=== Phase 2: last-seats rush - many clients racing for the SAME few remaining seats ===");

  // Free up a small, known set of seats on DEC_26 so this phase has a
  // guaranteed, predictable contention point regardless of what phase 1 did.
  const TARGET_SEATS = [1, 2, 3, 4, 5];
  await prisma.seat.updateMany({
    where: { day: EventDay.DEC_26, seatNumber: { in: TARGET_SEATS } },
    data: { status: "FREE", lockToken: null, lockedUntil: null, bookingId: null },
  });

  const CLIENTS = 150; // 150 clients chasing 5 seats
  const start = Date.now();
  const outcomes = await Promise.all(
    Array.from({ length: CLIENTS }, (_, i) => {
      const seatNumber = TARGET_SEATS[i % TARGET_SEATS.length] as number;
      return attemptBooking(EventDay.DEC_26, [seatNumber], fakeIp(100_000 + i));
    }),
  );
  const durationMs = Date.now() - start;

  const stats = summarize(outcomes);
  console.log(`Done in ${durationMs}ms:`, stats);

  if (stats.booked !== TARGET_SEATS.length) {
    throw new Error(
      `Expected exactly ${TARGET_SEATS.length} successful bookings for the contested seats, got ${stats.booked}`,
    );
  }
  console.log(`Confirmed: exactly ${TARGET_SEATS.length} of the ${CLIENTS} racing clients won a seat - one per seat.`);
  return stats;
}

async function main() {
  console.log(`Load-testing ${BASE_URL} ...`);
  const health = await fetch(`${BASE_URL}/api/seats`).catch(() => null);
  if (!health || !health.ok) {
    console.error(`Server at ${BASE_URL} is not reachable. Start it first (npm run build && npm run start).`);
    process.exit(1);
  }

  await resetDb();
  await phaseGeneralLoad();
  await phaseLastSeatsRush();
  await assertNoDoubleBookings();

  console.log("\nLOAD TEST PASSED: no seat was ever booked twice, even under heavy concurrent contention.");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("\nLOAD TEST FAILED:", err);
  await prisma.$disconnect();
  process.exit(1);
});
