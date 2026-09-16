// Client-safe day constants: deliberately does NOT import "@prisma/client"
// (that package is Node/server-only) so this file can be imported from
// "use client" components without pulling server code into the browser
// bundle. The string values must stay in sync with the Prisma EventDay enum
// in prisma/schema.prisma.
export type EventDayId = "DEC_24" | "DEC_25" | "DEC_26";

export const ALL_DAY_IDS: EventDayId[] = ["DEC_24", "DEC_25", "DEC_26"];

export const SEATS_PER_DAY = 50;

export const LOCK_DURATION_MS = 10 * 60 * 1000;

export const DAY_INFO: Record<EventDayId, { label: string; short: string }> = {
  DEC_24: { label: "December 24.", short: "Dec. 24." },
  DEC_25: { label: "December 25.", short: "Dec. 25." },
  DEC_26: { label: "December 26.", short: "Dec. 26." },
};

export type SeatStatusId = "FREE" | "LOCKED" | "BOOKED";
