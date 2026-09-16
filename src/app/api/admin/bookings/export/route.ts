import { prisma } from "@/lib/db";
import { DAY_INFO } from "@/lib/config";

function csvEscape(value: string): string {
  if (/[",\n;]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET() {
  const bookings = await prisma.booking.findMany({
    include: { seats: { select: { day: true, seatNumber: true } } },
    orderBy: { createdAt: "desc" },
  });

  const header = [
    "Foglalasi azonosito",
    "Nev",
    "Email",
    "Telefonszam",
    "Foglalas idopontja",
    "Napok",
    "Helyek szama",
    "Helyszamok",
  ];

  const rows = bookings.map((b) => {
    const byDay = new Map<string, number[]>();
    for (const s of b.seats) {
      byDay.set(s.day, [...(byDay.get(s.day) ?? []), s.seatNumber]);
    }
    const days = Array.from(byDay.keys())
      .map((d) => DAY_INFO[d as keyof typeof DAY_INFO].label)
      .join(" | ");
    const seatList = Array.from(byDay.entries())
      .map(([d, nums]) => `${DAY_INFO[d as keyof typeof DAY_INFO].short}: ${nums.sort((a, c) => a - c).join(",")}`)
      .join(" | ");

    return [
      b.publicId,
      b.name,
      b.email,
      b.phone,
      b.createdAt.toISOString(),
      days,
      String(b.seats.length),
      seatList,
    ];
  });

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(";")).join("\r\n");
  const withBom = "﻿" + csv;

  return new Response(withBom, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="foglalasok-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
