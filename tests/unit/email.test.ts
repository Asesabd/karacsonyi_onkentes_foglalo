import { describe, it, expect, vi, afterEach } from "vitest";
import { sendBookingConfirmationEmailOnce } from "@/lib/email";
import { EventDay, EmailStatus } from "@prisma/client";

const bookingFixture = {
  id: "booking_1",
  publicId: "XMAS-8K4M2P",
  idempotencyKey: "token",
  name: "Kovács Anna",
  email: "anna@example.com",
  phone: "+36301234567",
  emailStatus: EmailStatus.PENDING,
  emailAttempts: 0,
  emailLastError: null,
  createdAt: new Date(),
  seats: [{ id: "s1", day: EventDay.DEC_24, seatNumber: 12, status: "BOOKED", lockedUntil: null, lockToken: null, bookingId: "booking_1", updatedAt: new Date() }],
} as Parameters<typeof sendBookingConfirmationEmailOnce>[0];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sendBookingConfirmationEmailOnce", () => {
  it("returns a typed failure (never throws) when RESEND_API_KEY is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const result = await sendBookingConfirmationEmailOnce(bookingFixture);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/RESEND_API_KEY/);
    }
  });

  it("returns a typed failure when EMAIL_FROM is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "");
    const result = await sendBookingConfirmationEmailOnce(bookingFixture);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/EMAIL_FROM/);
    }
  });
});
