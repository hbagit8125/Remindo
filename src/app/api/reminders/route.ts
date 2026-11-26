import { connection, NextResponse } from "next/server";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, reminders } from "@/db";
import { reminderInputSchema } from "@/lib/reminder-input";
import { createReminders } from "@/lib/create";
import { describeRrule } from "@/lib/recurrence";
import { withUndo } from "@/lib/undo-route";

export async function GET(req: Request) {
  await connection(); // always read fresh data, never prerender
  const category = new URL(req.url).searchParams.get("category");
  const where = category ? and(ne(reminders.status, "archived"), eq(reminders.category, category)) : ne(reminders.status, "archived");
  const rows = await db().select().from(reminders).where(where).orderBy(desc(reminders.createdAt));
  return NextResponse.json({
    reminders: rows.map((r) => ({ ...r, recurring: describeRrule(r.rrule) })),
  });
}

/** Create one or more reminders: { items: ReminderInput[] } */
export const POST = withUndo(async (req: Request) => {
  const body = await req.json().catch(() => null);
  const parsed = z.object({ items: z.array(reminderInputSchema).min(1).max(20) }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  }
  // Alerts due in the next 48h are queued right away; later ones are picked up by the daily cron.
  const created = await createReminders(parsed.data.items);
  return NextResponse.json({ created });
});
