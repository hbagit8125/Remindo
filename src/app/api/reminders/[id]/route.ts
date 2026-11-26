import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, reminders } from "@/db";
import { inputToRow, reminderInputSchema } from "@/lib/reminder-input";
import { cancelQueued, planAndQueue } from "@/lib/scheduler";
import { withUndo } from "@/lib/undo-route";
import { changeRow } from "@/lib/undo";
import { deleteReminders } from "@/lib/create";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const [r] = await db().select().from(reminders).where(eq(reminders.id, id));
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ reminder: r });
}

/** Edit a reminder: body is a ReminderInput. Old queued alerts are dropped and re-planned. */
export const PATCH = withUndo(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const parsed = reminderInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const [before] = await db().select().from(reminders).where(eq(reminders.id, id));
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const updated = await changeRow("reminders", id, `Edited “${before.title}”`, "edit", async () => {
    await cancelQueued(id);
    const [row] = await db()
      .update(reminders)
      .set({ ...inputToRow(parsed.data), status: "active", version: sql`${reminders.version} + 1`, updatedAt: new Date() })
      .where(eq(reminders.id, id))
      .returning();
    return row;
  });
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await planAndQueue({ reminderIds: [id] }).catch(() => null);
  return NextResponse.json({ reminder: updated });
});

export const DELETE = withUndo(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await deleteReminders([id]);
  return NextResponse.json({ ok: true });
});
