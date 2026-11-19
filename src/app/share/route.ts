import { NextResponse } from "next/server";

/**
 * Android "Share → Remindo" (Web Share Target). Shared text, such as a bank
 * SMS, opens the Ask sheet and is understood straight away.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const text = [u.searchParams.get("title"), u.searchParams.get("text"), u.searchParams.get("url")].filter(Boolean).join(" ").trim();
  const dest = new URL("/", u.origin);
  dest.searchParams.set("add", "ask");
  if (text) dest.searchParams.set("text", text.slice(0, 1500));
  return NextResponse.redirect(dest);
}
