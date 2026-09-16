import { NextResponse } from "next/server";
import { releaseExpiredLocks } from "@/lib/bookingService";
import { jsonError } from "@/lib/apiHelpers";

// Optional cron sweep. Correctness never depends on this running - every
// lock check re-verifies expiry with a row lock at the moment it matters -
// but running it periodically keeps the public seat map and admin stats
// looking fresh even with no traffic to trigger a lazy release.
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return jsonError(401, "UNAUTHORIZED", "Unauthorized.");
  }

  await releaseExpiredLocks();
  return NextResponse.json({ ok: true });
}
