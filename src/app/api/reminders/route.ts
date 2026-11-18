import { NextResponse } from "next/server";
import { desc, ne } from "drizzle-orm";
import { z } from "zod";
import { db, reminders } from "@/db";
import { inputToRow, reminderInputSchema } from "@/lib/reminder-input";
import { planAndQueue } from "@/lib/scheduler";
import { describeRrule } from "@/lib/recurrence";

export async function GET() {
  const rows = await db().select().from(reminders).where(ne(reminders.status, "archived")).orderBy(desc(reminders.createdAt));
  return NextResponse.json({
    reminders: rows.map((r) => ({ ...r, recurring: describeRrule(r.rrule) })),
  });
}

/** Create one or more reminders: { items: ReminderInput[] } */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = z.object({ items: z.array(reminderInputSchema).min(1).max(20) }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  }
  const created = await db().insert(reminders).values(parsed.data.items.map(inputToRow)).returning();
  // Queue anything due in the next 48h right away; later alerts are picked up by the daily cron.
  const plan = await planAndQueue({ reminderIds: created.map((r) => r.id) }).catch((e) => ({ error: String(e) }));
  return NextResponse.json({ created, plan });
}
