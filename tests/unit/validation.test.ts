import { describe, it, expect } from "vitest";
import { createLockSchema, finalizeBookingSchema, adminLoginSchema } from "@/lib/validation";
import { EventDay } from "@prisma/client";

describe("createLockSchema", () => {
  it("accepts a valid single-day, single-seat selection", () => {
    const result = createLockSchema.safeParse({
      selections: [{ day: EventDay.DEC_24, seatNumbers: [12] }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts multiple days in one request", () => {
    const result = createLockSchema.safeParse({
      selections: [
        { day: EventDay.DEC_24, seatNumbers: [1, 2] },
        { day: EventDay.DEC_25, seatNumbers: [3] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty selection list", () => {
    const result = createLockSchema.safeParse({ selections: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a seat number out of range", () => {
    const result = createLockSchema.safeParse({
      selections: [{ day: EventDay.DEC_24, seatNumbers: [51] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a seat number of zero or negative", () => {
    const result = createLockSchema.safeParse({
      selections: [{ day: EventDay.DEC_24, seatNumbers: [0] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate seat numbers within a day", () => {
    const result = createLockSchema.safeParse({
      selections: [{ day: EventDay.DEC_24, seatNumbers: [5, 5] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects the same day listed twice", () => {
    const result = createLockSchema.safeParse({
      selections: [
        { day: EventDay.DEC_24, seatNumbers: [1] },
        { day: EventDay.DEC_24, seatNumbers: [2] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid day value", () => {
    const result = createLockSchema.safeParse({
      selections: [{ day: "DEC_31", seatNumbers: [1] }],
    });
    expect(result.success).toBe(false);
  });
});

describe("finalizeBookingSchema", () => {
  const base = {
    lockToken: "A".repeat(32),
    name: "Kovács Anna",
    email: "anna@example.com",
    phone: "+36301234567",
  };

  it("accepts valid contact details", () => {
    expect(finalizeBookingSchema.safeParse(base).success).toBe(true);
  });

  it("rejects an invalid email", () => {
    expect(finalizeBookingSchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
  });

  it("rejects a too-short phone number", () => {
    expect(finalizeBookingSchema.safeParse({ ...base, phone: "123" }).success).toBe(false);
  });

  it("rejects a phone number with letters", () => {
    expect(finalizeBookingSchema.safeParse({ ...base, phone: "call-me-maybe" }).success).toBe(false);
  });

  it("rejects a one-character name", () => {
    expect(finalizeBookingSchema.safeParse({ ...base, name: "A" }).success).toBe(false);
  });

  it("rejects a non-empty honeypot field", () => {
    expect(finalizeBookingSchema.safeParse({ ...base, website: "http://spam.example" }).success).toBe(false);
  });

  it("rejects a missing lockToken", () => {
    const { lockToken: _lockToken, ...rest } = base;
    expect(finalizeBookingSchema.safeParse(rest).success).toBe(false);
  });
});

describe("adminLoginSchema", () => {
  it("accepts valid credentials shape", () => {
    expect(adminLoginSchema.safeParse({ email: "a@b.com", password: "x" }).success).toBe(true);
  });

  it("rejects an empty password", () => {
    expect(adminLoginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});
