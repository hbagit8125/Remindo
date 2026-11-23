import { NextResponse } from "next/server";
import { bumpEpoch, SESSION_COOKIE } from "@/lib/auth";

/** Signs out every device (including this one): all existing sessions stop working. */
export async function POST() {
  await bumpEpoch();
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
