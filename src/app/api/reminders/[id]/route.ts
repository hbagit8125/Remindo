import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, reminders } from "@/db";
import { inputToRow, reminderInputSchema } from "@/lib/reminder-input";
import { cancelQueued, planAndQueue } from "@/lib/scheduler";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const [r] = await db().select().from(reminders).where(eq(reminders.id, id));
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ reminder: r });
}

/** Edit a reminder: body is a ReminderInput. Old queued alerts are dropped and re-planned. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = reminderInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  await cancelQueued(id);
  const [updated] = await db()
    .update(reminders)
    .set({ ...inputToRow(parsed.data), status: "active", version: sql`${reminders.version} + 1`, updatedAt: new Date() })
    .where(eq(reminders.id, id))
    .returning();
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await planAndQueue({ reminderIds: [id] }).catch(() => null);
  return NextResponse.json({ reminder: updated });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await cancelQueued(id);
  await db().delete(reminders).where(eq(reminders.id, id));
  return NextResponse.json({ ok: true });
}
