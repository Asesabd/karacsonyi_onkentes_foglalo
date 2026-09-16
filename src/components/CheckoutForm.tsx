"use client";

import { useMemo, useRef, useState } from "react";
import { DAY_INFO, type EventDayId } from "@/lib/days";
import CountdownTimer from "@/components/CountdownTimer";

export interface LockedSeat {
  day: EventDayId;
  seatNumber: number;
}

interface CheckoutFormProps {
  lockedSeats: LockedSeat[];
  expiresAt: string;
  onExpire: () => void;
  onBack: () => void;
  onSubmit: (data: { name: string; email: string; phone: string; website: string; formRenderedAt: number }) => void;
  submitting: boolean;
  errorMessage: string | null;
}

export default function CheckoutForm({
  lockedSeats,
  expiresAt,
  onExpire,
  onBack,
  onSubmit,
  submitting,
  errorMessage,
}: CheckoutFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string; phone?: string }>({});
  const formRenderedAt = useRef(Date.now());

  const byDay = useMemo(() => {
    const map = new Map<EventDayId, number[]>();
    for (const s of lockedSeats) {
      map.set(s.day, [...(map.get(s.day) ?? []), s.seatNumber].sort((a, b) => a - b));
    }
    return map;
  }, [lockedSeats]);

  const total = lockedSeats.length;

  function validate(): boolean {
    const errors: typeof fieldErrors = {};
    if (name.trim().length < 2) errors.name = "Kérjük, add meg a teljes neved.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = "Érvénytelen e-mail cím.";
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 6) errors.phone = "Érvénytelen telefonszám.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    const honeypot = (e.currentTarget as HTMLFormElement).elements.namedItem("website") as HTMLInputElement | null;
    onSubmit({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      website: honeypot?.value ?? "",
      formRenderedAt: formRenderedAt.current,
    });
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <CountdownTimer expiresAt={expiresAt} onExpire={onExpire} />

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-2 font-semibold text-xmas-green">Foglalásod</h2>
        <ul className="space-y-1 text-sm text-gray-700">
          {Array.from(byDay.entries()).map(([day, seats]) => (
            <li key={day}>
              <strong>{DAY_INFO[day].label}</strong> — {seats.length} hely ({seats.join(", ")}. hely)
            </li>
          ))}
        </ul>
        <p className="mt-2 font-semibold">Összesen: {total} önkéntes hely</p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-gray-800">
            Név
          </label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? "name-error" : undefined}
            className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-xmas-green"
          />
          {fieldErrors.name && (
            <p id="name-error" role="alert" className="mt-1 text-sm text-xmas-red">
              {fieldErrors.name}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-800">
            E-mail cím
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
            className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-xmas-green"
          />
          {fieldErrors.email && (
            <p id="email-error" role="alert" className="mt-1 text-sm text-xmas-red">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="phone" className="mb-1 block text-sm font-medium text-gray-800">
            Telefonszám
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={Boolean(fieldErrors.phone)}
            aria-describedby={fieldErrors.phone ? "phone-error" : undefined}
            className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-xmas-green"
          />
          {fieldErrors.phone && (
            <p id="phone-error" role="alert" className="mt-1 text-sm text-xmas-red">
              {fieldErrors.phone}
            </p>
          )}
        </div>

        {/* Honeypot field - hidden from real users via CSS, not "display:none" (some bots skip those). */}
        <div className="absolute left-[-9999px]" aria-hidden="true">
          <label htmlFor="website">Website</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        {errorMessage && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-xmas-red">
            {errorMessage}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={onBack}
            disabled={submitting}
            className="min-h-11 rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50"
          >
            Vissza a helyválasztáshoz
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="min-h-11 rounded-lg bg-xmas-red px-5 py-2.5 font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Foglalás rögzítése…" : "Véglegesítem a foglalást"}
          </button>
        </div>
      </form>
    </div>
  );
}
