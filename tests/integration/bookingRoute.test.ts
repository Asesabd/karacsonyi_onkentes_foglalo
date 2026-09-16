import { describe, it, expect, beforeEach, afterAll, vi, afterEach } from "vitest";
import { EventDay, EmailStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLock } from "@/lib/bookingService";
import { POST as finalizeBookingRoute } from "@/app/api/bookings/route";
import { resetDb } from "../testUtils";

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

function postJson(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.5" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/bookings - email failure isolation", () => {
  it("still confirms the booking (never loses or duplicates it) when the confirmation email fails to send", async () => {
    vi.stubEnv("RESEND_API_KEY", ""); // force sendBookingConfirmationEmailOnce to fail deterministically, no network call

    const lock = await createLock([{ day: EventDay.DEC_24, seatNumbers: [17] }]);
    const request = postJson("http://localhost/api/bookings", {
      lockToken: lock.lockToken,
      name: "Email Hiba Teszt",
      email: "emailhiba@example.com",
      phone: "+36301234567",
      website: "",
      formRenderedAt: Date.now() - 5000,
    });

    const response = await finalizeBookingRoute(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.publicId).toMatch(/^XMAS-/);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { publicId: body.publicId } });
    expect(booking.emailStatus).toBe(EmailStatus.FAILED);
    expect(booking.emailAttempts).toBe(1);

    const bookingCount = await prisma.booking.count();
    expect(bookingCount).toBe(1); // the booking itself was not lost, and is not duplicated
  });

  it("rejects a submission where the honeypot field is filled in", async () => {
    const lock = await createLock([{ day: EventDay.DEC_25, seatNumbers: [18] }]);
    const request = postJson("http://localhost/api/bookings", {
      lockToken: lock.lockToken,
      name: "Bot Teszt",
      email: "bot@example.com",
      phone: "+36301234567",
      website: "http://spam.example",
      formRenderedAt: Date.now() - 5000,
    });

    const response = await finalizeBookingRoute(request);
    expect(response.status).toBe(400);
    const bookingCount = await prisma.booking.count();
    expect(bookingCount).toBe(0);
  });

  it("rejects a submission that was completed impossibly fast (bot timing signal)", async () => {
    const lock = await createLock([{ day: EventDay.DEC_25, seatNumbers: [19] }]);
    const request = postJson("http://localhost/api/bookings", {
      lockToken: lock.lockToken,
      name: "Gyors Bot",
      email: "gyors@example.com",
      phone: "+36301234567",
      website: "",
      formRenderedAt: Date.now(), // submitted instantly
    });

    const response = await finalizeBookingRoute(request);
    expect(response.status).toBe(400);
  });

  it("rejects invalid contact details with 400 and does not touch the seats", async () => {
    const lock = await createLock([{ day: EventDay.DEC_26, seatNumbers: [20] }]);
    const request = postJson("http://localhost/api/bookings", {
      lockToken: lock.lockToken,
      name: "X",
      email: "not-an-email",
      phone: "1",
      website: "",
    });

    const response = await finalizeBookingRoute(request);
    expect(response.status).toBe(400);

    const seat = await prisma.seat.findUniqueOrThrow({ where: { day_seatNumber: { day: EventDay.DEC_26, seatNumber: 20 } } });
    expect(seat.status).toBe("LOCKED"); // lock is untouched, still reserved for this user to retry
  });
});
