import { NextResponse } from "next/server";
import { getAllSeatMaps, getSeatMapForDay } from "@/lib/bookingService";
import { isEventDay } from "@/lib/config";
import { jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

// Public endpoint: intentionally returns only { seatNumber, status } - never
// who booked a seat. Anyone can poll this to render the live seat map.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const day = searchParams.get("day");

  if (day !== null && !isEventDay(day)) {
    return jsonError(400, "INVALID_DAY", "Érvénytelen nap.");
  }

  const data = isEventDay(day) ? { [day]: await getSeatMapForDay(day) } : await getAllSeatMaps();

  return NextResponse.json(
    { seats: data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
