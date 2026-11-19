import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, pushSubscriptions } from "@/db";

const schema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  label: z.string().max(100).optional(),
});

/** Save this device's push subscription. */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  const { endpoint, keys, label } = parsed.data;
  await db()
    .insert(pushSubscriptions)
    .values({ endpoint, p256dh: keys.p256dh, auth: keys.auth, label: label || null })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { p256dh: keys.p256dh, auth: keys.auth, label: label || null } });
  return NextResponse.json({ ok: true });
}

/** Turn off push on this device. */
export async function DELETE(req: Request) {
  const { endpoint } = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (endpoint) await db().delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  return NextResponse.json({ ok: true });
}
