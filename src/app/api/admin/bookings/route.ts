import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { adminBookingsQuerySchema } from "@/lib/validation";
import { jsonError } from "@/lib/apiHelpers";
import type { Prisma } from "@prisma/client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = adminBookingsQuerySchema.safeParse({
    search: searchParams.get("search") ?? undefined,
    day: searchParams.get("day") ?? undefined,
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
  });

  if (!parsed.success) {
    return jsonError(400, "VALIDATION_ERROR", "Érvénytelen szűrő.");
  }

  const { search, day, page, pageSize } = parsed.data;

  const where: Prisma.BookingWhereInput = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
      { publicId: { contains: search, mode: "insensitive" } },
    ];
  }
  if (day) {
    where.seats = { some: { day } };
  }

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: { seats: { select: { day: true, seatNumber: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.booking.count({ where }),
  ]);

  return NextResponse.json({
    bookings: bookings.map((b) => ({
      id: b.id,
      publicId: b.publicId,
      name: b.name,
      email: b.email,
      phone: b.phone,
      createdAt: b.createdAt.toISOString(),
      emailStatus: b.emailStatus,
      seats: b.seats,
      seatCount: b.seats.length,
    })),
    total,
    page,
    pageSize,
  });
}
