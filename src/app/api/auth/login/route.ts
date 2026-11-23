import { NextResponse } from "next/server";
import { createSession, safeEqual, SESSION_COOKIE } from "@/lib/auth";
import { clientIp, loginBlocked, recordFailure, recordSuccess } from "@/lib/login-guard";

export async function POST(req: Request) {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return NextResponse.json({ error: "Sign-in isn't set up on the server" }, { status: 500 });

  const ip = clientIp(req);
  const wait = await loginBlocked(ip);
  if (wait) {
    return NextResponse.json({ error: `Too many wrong tries. Try again in ${wait} minute${wait === 1 ? "" : "s"}.` }, { status: 429, headers: { "Retry-After": String(wait * 60) } });
  }

  const { passcode } = (await req.json().catch(() => ({}))) as { passcode?: unknown };
  if (typeof passcode !== "string" || passcode.length > 200 || !safeEqual(passcode, expected)) {
    await recordFailure(ip);
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return NextResponse.json({ error: "Wrong passcode" }, { status: 401 });
  }

  await recordSuccess(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });
  return res;
}
