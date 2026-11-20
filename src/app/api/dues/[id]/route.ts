import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, dues } from "@/db";
import { settleDue } from "@/lib/moneyplus";

type Ctx = { params: Promise<{ id: string }> };

/** Settle: { log: boolean, accountId? } — log=true records the money received/paid. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { log = true, accountId = null } = (await req.json().catch(() => ({}))) as { log?: boolean; accountId?: string | null };
  const d = await settleDue(id, { log, accountId });
  return d ? NextResponse.json({ due: d }) : NextResponse.json({ error: "Already settled or not found" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const [d] = await db().delete(dues).where(eq(dues.id, id)).returning();
  // Remove its "Collect ₹… from …" reminder too.
  if (d?.reminderId) {
    const { cancelQueued } = await import("@/lib/scheduler");
    const { reminders } = await import("@/db");
    await cancelQueued(d.reminderId);
    await db().delete(reminders).where(eq(reminders.id, d.reminderId));
  }
  return NextResponse.json({ ok: true });
}
