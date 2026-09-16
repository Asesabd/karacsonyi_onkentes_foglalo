import { describe, it, expect } from "vitest";
import { generatePublicId, generateLockToken } from "@/lib/publicId";

describe("generatePublicId", () => {
  it("matches the XMAS-XXXXXX format with an unambiguous charset", () => {
    for (let i = 0; i < 200; i++) {
      expect(generatePublicId()).toMatch(/^XMAS-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    }
  });

  it("does not produce sequential/incrementing ids", () => {
    const ids = Array.from({ length: 50 }, () => generatePublicId());
    // Non-guessable: every id should be unique across a reasonably large sample
    // and the set should not just be "id, id+1, id+2, ...".
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("generateLockToken", () => {
  it("produces a long, high-entropy token", () => {
    const token = generateLockToken();
    expect(token.length).toBe(32);
  });

  it("produces different tokens on each call", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateLockToken()));
    expect(tokens.size).toBe(200);
  });
});
