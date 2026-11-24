import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { ACTIONS, performAction, type ActionName } from "@/lib/actions";

/** Called by the service worker when you tap Done / Snooze on a notification. */
export async function POST(req: Request) {
  const { t } = (await req.json().catch(() => ({}))) as { t?: string };
  const payload = await verifyToken<{ did: string; act: string }>(t);
  if (!payload || !(ACTIONS as readonly string[]).includes(payload.act)) {
    return NextResponse.json({ error: "Invalid or expired" }, { status: 400 });
  }
  return NextResponse.json(await performAction(payload.did, payload.act as ActionName, "push"));
}
