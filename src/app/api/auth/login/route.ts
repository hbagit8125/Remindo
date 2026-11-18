import { NextResponse } from "next/server";
import { createSession, safeEqual, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: Request) {
  const { passcode } = (await req.json().catch(() => ({}))) as { passcode?: string };
  const expected = process.env.APP_PASSCODE;
  if (!expected) return NextResponse.json({ error: "APP_PASSCODE is not set on the server" }, { status: 500 });
  if (!passcode || !safeEqual(passcode, expected)) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return NextResponse.json({ error: "Wrong passcode" }, { status: 401 });
  }
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
