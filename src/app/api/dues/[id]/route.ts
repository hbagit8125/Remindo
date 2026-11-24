import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, dues } from "@/db";
import { settleDue, unsettleDue } from "@/lib/moneyplus";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/** Settle: { log: boolean, accountId? } — log=true records the money received/paid. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const { log = true, accountId = null } = (await req.json().catch(() => ({}))) as { log?: boolean; accountId?: string | null };
  const d = await settleDue(id, { log, accountId });
  return d ? NextResponse.json({ due: d }) : NextResponse.json({ error: "Already settled or not found" }, { status: 404 });
}

/** Undo "paid back": { settled: false }. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const { settled } = (await req.json().catch(() => ({}))) as { settled?: boolean };
  if (settled !== false) return NextResponse.json({ error: "Bad input" }, { status: 400 });
  const d = await unsettleDue(id);
  return d ? NextResponse.json({ due: d }) : notFound();
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const [d] = await db().delete(dues).where(eq(dues.id, id)).returning();
  // Remove its "Collect ₹… from …" reminder too.
  if (d?.reminderId) {
    const { cancelQueued } = await import("@/lib/scheduler");
    const { reminders } = await import("@/db");
    await cancelQueued(d.reminderId);
    await db().delete(reminders).where(eq(reminders.id, d.reminderId));
  }
  return d ? NextResponse.json({ ok: true }) : notFound();
}
