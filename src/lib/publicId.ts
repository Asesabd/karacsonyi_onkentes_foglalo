import { randomInt } from "node:crypto";

// Unambiguous charset: no 0/O, 1/I/L, etc. so it reads cleanly over phone/email.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const ID_LENGTH = 6;

function randomChar(): string {
  // randomInt(ALPHABET.length) is always a valid index into ALPHABET.
  return ALPHABET[randomInt(ALPHABET.length)] as string;
}

/** Generates a random, non-sequential public booking id, e.g. "XMAS-8K4M2P". */
export function generatePublicId(): string {
  let suffix = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    suffix += randomChar();
  }
  return `XMAS-${suffix}`;
}

/** Cryptographically random token identifying one lock/checkout session. */
export function generateLockToken(): string {
  const bytes: string[] = [];
  for (let i = 0; i < 32; i++) {
    bytes.push(randomChar());
  }
  return bytes.join("");
}
