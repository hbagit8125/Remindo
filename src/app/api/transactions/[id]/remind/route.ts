import { NextResponse } from "next/server";
import { and, eq, ilike, isNotNull } from "drizzle-orm";
import { db, reminders, transactions } from "@/db";
import { createReminders } from "@/lib/create";
import { fmtLocal } from "@/lib/time";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turn an expense into a monthly bill reminder (same day each month, with the amount),
 * so next time you get reminded and can log it with one tap.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [t] = await db().select().from(transactions).where(eq(transactions.id, id));
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (t.type !== "expense") return NextResponse.json({ error: "Only expenses can become bill reminders" }, { status: 400 });

  const title = (t.note || t.merchant || t.category).replace(/^\w/, (c) => c.toUpperCase());
  // Already have a repeating reminder for this? Don't make a second one.
  const [existing] = await db()
    .select()
    .from(reminders)
    .where(and(eq(reminders.status, "active"), isNotNull(reminders.rrule), ilike(reminders.title, title)));
  if (existing) return NextResponse.json({ reminder: existing, existed: true });

  // Same day next month (last day of the month if it's shorter, e.g. 31st → 30th).
  const [y, m, d] = t.date.split("-").map(Number);
  const today = fmtLocal(new Date(), "yyyy-MM-dd");
  let ny = y;
  let nm = m + 1;
  let date = "";
  for (;;) {
    if (nm > 12) {
      nm = 1;
      ny++;
    }
    const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    date = `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
    if (date > today) break;
    nm++;
  }

  const [r] = await createReminders([
    {
      title,
      notes: `Monthly bill · last paid ${t.date}`,
      date,
      time: "10:00",
      recurrence: "monthly",
      monthDay: d,
      interval: 1,
      priority: "normal",
      category: t.category,
      amount: t.amountPaise / 100,
      // A day before and on the day.
      leadTimes: [1440, 0],
    },
  ]);
  return NextResponse.json({ reminder: r, existed: false });
}
