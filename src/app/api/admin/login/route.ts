import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { adminLoginSchema } from "@/lib/validation";
import { signAdminSession, ADMIN_COOKIE_NAME, ADMIN_COOKIE_OPTIONS } from "@/lib/auth";
import { enforceRateLimit, enforceSameOrigin, jsonError } from "@/lib/apiHelpers";

export async function POST(request: Request) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;

  const rateLimited = await enforceRateLimit(request, "admin-login", 10, 5 * 60_000);
  if (rateLimited) return rateLimited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "INVALID_JSON", "Érvénytelen kérés formátum.");
  }

  const parsed = adminLoginSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_ERROR", "Érvénytelen adatok.");
  }

  const admin = await prisma.adminUser.findUnique({ where: { email: parsed.data.email } });

  // Always run bcrypt.compare (against a dummy hash if no user found) so
  // the response time doesn't leak whether the email exists.
  const hashToCheck = admin?.passwordHash ?? "$2a$12$invalidsaltinvalidsaltinvalidsaltinvalidsaltinvalidsa";
  const validPassword = await bcrypt.compare(parsed.data.password, hashToCheck);

  if (!admin || !validPassword) {
    return jsonError(401, "INVALID_CREDENTIALS", "Hibás e-mail cím vagy jelszó.");
  }

  const token = await signAdminSession({ adminId: admin.id, email: admin.email });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE_NAME, token, ADMIN_COOKIE_OPTIONS);
  return response;
}
