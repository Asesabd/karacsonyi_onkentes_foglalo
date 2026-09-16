import { Resend } from "resend";
import type { Booking, Seat } from "@prisma/client";
import { DAY_INFO } from "@/lib/config";

type BookingWithSeats = Booking & { seats: Seat[] };

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

function groupSeatsByDay(seats: Seat[]) {
  const byDay = new Map<string, number[]>();
  for (const seat of seats) {
    const list = byDay.get(seat.day) ?? [];
    list.push(seat.seatNumber);
    byDay.set(seat.day, list);
  }
  for (const list of byDay.values()) list.sort((a, b) => a - b);
  return byDay;
}

function renderEmailText(booking: BookingWithSeats): string {
  const byDay = groupSeatsByDay(booking.seats);
  const firstName = booking.name.split(" ")[0] ?? booking.name;

  const dayBlocks = Array.from(byDay.entries())
    .map(([day, seatNumbers]) => {
      const info = DAY_INFO[day as keyof typeof DAY_INFO];
      return `${info.label}\nLefoglalt helyek száma: ${seatNumbers.length}\nHelyek: ${seatNumbers.join(", ")}`;
    })
    .join("\n\n");

  const total = booking.seats.length;

  return `Kedves ${firstName}!

Köszönjük, hogy jelentkeztél karácsonyi önkéntes programunkra! 🎄
Foglalásod sikeresen rögzítettük.

${dayBlocks}

Összesen lefoglalt helyek: ${total}

Foglalási azonosító:
${booking.publicId}

Várunk szeretettel!`;
}

function renderEmailHtml(booking: BookingWithSeats): string {
  const byDay = groupSeatsByDay(booking.seats);
  const firstName = booking.name.split(" ")[0] ?? booking.name;

  const dayBlocksHtml = Array.from(byDay.entries())
    .map(([day, seatNumbers]) => {
      const info = DAY_INFO[day as keyof typeof DAY_INFO];
      return `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #eee;">
            <strong style="color:#1c5e3f;font-size:16px;">${info.label}</strong><br/>
            Lefoglalt helyek száma: <strong>${seatNumbers.length}</strong><br/>
            Helyek: ${seatNumbers.join(", ")}
          </td>
        </tr>`;
    })
    .join("");

  const total = booking.seats.length;

  return `<!doctype html>
<html lang="hu">
  <body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#fdf6ec; padding:24px; color:#1a1a1a;">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #eee;">
      <h1 style="color:#1c5e3f;font-size:20px;margin-top:0;">Kedves ${escapeHtml(firstName)}! 🎄</h1>
      <p>Köszönjük, hogy jelentkeztél karácsonyi önkéntes programunkra! Foglalásod sikeresen rögzítettük.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">${dayBlocksHtml}</table>
      <p><strong>Összesen lefoglalt helyek:</strong> ${total}</p>
      <p style="margin-top:24px;padding:12px;background:#fdf6ec;border-radius:8px;">
        Foglalási azonosító:<br/>
        <strong style="font-size:18px;letter-spacing:1px;color:#b3282d;">${escapeHtml(booking.publicId)}</strong>
      </p>
      <p>Várunk szeretettel!</p>
    </div>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type SendResult = { ok: true } | { ok: false; error: string };

/**
 * Sends the booking confirmation email exactly once (no retry sleeps), so
 * it is cheap to call inline from the booking API without adding latency
 * to the user-facing response. The booking row is already committed before
 * this is ever called, so a failure here never loses or duplicates the
 * booking itself - callers just persist the resulting status on the
 * Booking row (emailStatus/emailAttempts) and the cron retry job (see
 * sendBookingConfirmationEmailWithRetries) picks up any failures later.
 */
export async function sendBookingConfirmationEmailOnce(booking: BookingWithSeats): Promise<SendResult> {
  const client = getResendClient();
  if (!client) {
    return { ok: false, error: "RESEND_API_KEY is not configured" };
  }
  const from = process.env.EMAIL_FROM;
  if (!from) {
    return { ok: false, error: "EMAIL_FROM is not configured" };
  }

  try {
    const result = await client.emails.send({
      from,
      to: booking.email,
      subject: "Foglalás visszaigazolása - Karácsonyi Önkéntes Program",
      text: renderEmailText(booking),
      html: renderEmailHtml(booking),
    });
    if (result.error) {
      return { ok: false, error: result.error.message };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const RETRY_DELAYS_MS = [1000, 5000, 15000];

/**
 * Used by the cron retry endpoint for bookings whose confirmation email is
 * still FAILED: tries several times with backoff since latency doesn't
 * matter there.
 */
export async function sendBookingConfirmationEmailWithRetries(booking: BookingWithSeats): Promise<SendResult> {
  let last: SendResult = { ok: false, error: "not attempted" };
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    last = await sendBookingConfirmationEmailOnce(booking);
    if (last.ok) return last;
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return last;
}
