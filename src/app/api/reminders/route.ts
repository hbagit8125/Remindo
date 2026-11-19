import { connection, NextResponse } from "next/server";
import { desc, ne } from "drizzle-orm";
import { z } from "zod";
import { db, reminders } from "@/db";
import { reminderInputSchema } from "@/lib/reminder-input";
import { createReminders } from "@/lib/create";
import { describeRrule } from "@/lib/recurrence";

export async function GET() {
  await connection(); // always read fresh data, never prerender
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
  // Alerts due in the next 48h are queued right away; later ones are picked up by the daily cron.
  const created = await createReminders(parsed.data.items);
  return NextResponse.json({ created });
}
