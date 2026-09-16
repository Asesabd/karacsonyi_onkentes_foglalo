"use client";

import useSWR from "swr";
import Link from "next/link";
import { DAY_INFO, type EventDayId } from "@/lib/days";

interface BookingResponse {
  publicId: string;
  name: string;
  email: string;
  createdAt: string;
  seats: { day: EventDayId; seatNumber: number }[];
}

async function fetcher(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? "A foglalás nem található.");
  }
  return res.json() as Promise<BookingResponse>;
}

export default function ConfirmationView({ publicId }: { publicId: string }) {
  const { data, error, isLoading } = useSWR(`/api/bookings/${publicId}`, fetcher);

  if (isLoading) {
    return <p className="text-center text-gray-600">Betöltés…</p>;
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="font-semibold text-xmas-red">A foglalás nem található.</p>
        <Link href="/" className="mt-3 inline-block text-xmas-green underline">
          Vissza a főoldalra
        </Link>
      </div>
    );
  }

  const byDay = new Map<EventDayId, number[]>();
  for (const s of data.seats) {
    byDay.set(s.day, [...(byDay.get(s.day) ?? []), s.seatNumber].sort((a, b) => a - b));
  }
  const total = data.seats.length;
  const firstName = data.name.split(" ")[0] ?? data.name;

  return (
    <div className="space-y-5 text-center">
      <div>
        <p className="text-4xl" aria-hidden="true">
          🎄
        </p>
        <h1 className="mt-2 text-2xl font-bold text-xmas-green">Sikeres foglalás!</h1>
        <p className="mt-1 text-gray-700">Köszönjük, hogy jelentkeztél önkéntesnek, {firstName}!</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 text-left">
        <ul className="space-y-1 text-sm text-gray-700">
          {Array.from(byDay.entries()).map(([day, seats]) => (
            <li key={day}>
              <strong>{DAY_INFO[day].label}</strong> — {seats.length} hely ({seats.join(", ")}. hely)
            </li>
          ))}
        </ul>
        <p className="mt-2 font-semibold">Összesen {total} önkéntes helyet foglaltál.</p>
      </div>

      <div className="rounded-xl bg-xmas-cream p-4">
        <p className="text-sm text-gray-600">Foglalási azonosító</p>
        <p className="text-xl font-bold tracking-wide text-xmas-red">{data.publicId}</p>
      </div>

      <p className="text-sm text-gray-600">
        A visszaigazolást elküldtük a(z) <strong>{data.email}</strong> e-mail címre.
      </p>

      <Link href="/" className="inline-block text-xmas-green underline">
        Vissza a főoldalra
      </Link>
    </div>
  );
}
