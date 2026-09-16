import type { EventDay } from "@prisma/client";
import { ALL_DAY_IDS, DAY_INFO as DAY_INFO_BASE, SEATS_PER_DAY, LOCK_DURATION_MS } from "@/lib/days";

// Server-side re-typing of the client-safe day constants (src/lib/days.ts)
// against the real Prisma enum, so server code (API routes, bookingService)
// gets full type safety when passing days into Prisma calls. The string
// values are identical by construction - keep prisma/schema.prisma's
// EventDay enum in sync with src/lib/days.ts if these ever change.
export { SEATS_PER_DAY, LOCK_DURATION_MS };
export const DAY_INFO = DAY_INFO_BASE as unknown as Record<EventDay, { label: string; short: string; iso?: string }>;
export const ALL_DAYS = ALL_DAY_IDS as unknown as EventDay[];

export function isEventDay(value: unknown): value is EventDay {
  return typeof value === "string" && (ALL_DAY_IDS as string[]).includes(value);
}
