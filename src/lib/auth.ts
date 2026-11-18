import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "ra_session";

function key() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function signToken(payload: Record<string, unknown>, expiresIn: string) {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(expiresIn).sign(key());
}

export async function verifyToken<T = Record<string, unknown>>(token: string | undefined | null): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return payload as T;
  } catch {
    return null;
  }
}

export function createSession() {
  return signToken({ sub: "owner" }, "30d");
}

export async function isValidSession(token: string | undefined) {
  const p = await verifyToken<{ sub?: string }>(token);
  return p?.sub === "owner";
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/** Cron endpoints accept `Authorization: Bearer <CRON_SECRET>` (Vercel) or `?secret=` (cron-job.org). */
export function isCronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  const q = new URL(req.url).searchParams.get("secret") || "";
  return safeEqual(header, `Bearer ${secret}`) || safeEqual(q, secret);
}
