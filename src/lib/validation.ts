import { z } from "zod";
import { EventDay } from "@prisma/client";
import { SEATS_PER_DAY } from "@/lib/config";

const eventDaySchema = z.nativeEnum(EventDay);

const seatNumberSchema = z.number().int().min(1).max(SEATS_PER_DAY);

export const daySelectionSchema = z.object({
  day: eventDaySchema,
  seatNumbers: z
    .array(seatNumberSchema)
    .min(1, "Legalább egy helyet ki kell választani.")
    .max(SEATS_PER_DAY)
    .refine((arr) => new Set(arr).size === arr.length, "A helyszámok nem ismétlődhetnek."),
});

export const createLockSchema = z.object({
  selections: z
    .array(daySelectionSchema)
    .min(1, "Legalább egy napot és helyet ki kell választani.")
    .max(3)
    .refine((arr) => {
      const days = arr.map((s) => s.day);
      return new Set(days).size === days.length;
    }, "Egy nap csak egyszer szerepelhet a kiválasztásban."),
  // Honeypot field: real users never fill this hidden input.
  website: z.string().max(0).optional().or(z.literal("")),
});

export type CreateLockInput = z.infer<typeof createLockSchema>;

const nameSchema = z
  .string()
  .trim()
  .min(2, "A név túl rövid.")
  .max(120, "A név túl hosszú.");

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Érvénytelen e-mail cím.")
  .max(254);

// Loosely validates Hungarian-friendly phone numbers while staying
// permissive enough for international volunteers.
const phoneSchema = z
  .string()
  .trim()
  .min(6, "A telefonszám túl rövid.")
  .max(25, "A telefonszám túl hosszú.")
  .regex(/^[0-9+()\s-]+$/, "A telefonszám csak számokat és + ( ) - karaktereket tartalmazhat.")
  .refine((v) => v.replace(/\D/g, "").length >= 6, "A telefonszám túl rövid.");

export const finalizeBookingSchema = z.object({
  lockToken: z.string().min(10).max(64),
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  // Honeypot + minimum time-on-form are lightweight bot signals.
  website: z.string().max(0).optional().or(z.literal("")),
  formRenderedAt: z.number().int().positive().optional(),
});

export type FinalizeBookingInput = z.infer<typeof finalizeBookingSchema>;

export const adminLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const adminBookingsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  day: eventDaySchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
