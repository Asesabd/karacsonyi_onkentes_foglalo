import { NextResponse } from "next/server";
import { deleteBooking } from "@/lib/bookingService";
import { enforceSameOrigin, jsonError } from "@/lib/apiHelpers";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;

  const { id } = await params;

  const result = await deleteBooking(id);
  if (!result.ok) {
    return jsonError(404, "NOT_FOUND", "A foglalás nem található.");
  }

  return NextResponse.json({ ok: true });
}
