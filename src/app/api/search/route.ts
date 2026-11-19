import { NextResponse } from "next/server";
import { and, desc, ilike, ne, or, eq } from "drizzle-orm";
import { db, reminders, tasks, transactions } from "@/db";
import { describeRrule } from "@/lib/recurrence";

/** Search reminders, tasks and money entries: ?q=text (or an amount like 450). */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 100);
  if (q.length < 2) return NextResponse.json({ reminders: [], tasks: [], transactions: [] });
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const amount = Number(q.replace(/[₹,\s]/g, ""));
  const amountPaise = Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;

  const [r, t, tx] = await Promise.all([
    db()
      .select()
      .from(reminders)
      .where(and(ne(reminders.status, "archived"), or(ilike(reminders.title, like), ilike(reminders.notes, like), ilike(reminders.category, like))))
      .orderBy(desc(reminders.dueAt))
      .limit(15),
    db()
      .select()
      .from(tasks)
      .where(or(ilike(tasks.title, like), ilike(tasks.notes, like)))
      .orderBy(desc(tasks.createdAt))
      .limit(15),
    db()
      .select()
      .from(transactions)
      .where(
        or(
          ilike(transactions.note, like),
          ilike(transactions.merchant, like),
          ilike(transactions.category, like),
          ...(amountPaise ? [eq(transactions.amountPaise, amountPaise)] : []),
        ),
      )
      .orderBy(desc(transactions.date))
      .limit(20),
  ]);
  return NextResponse.json({
    reminders: r.map((x) => ({ ...x, recurring: describeRrule(x.rrule) })),
    tasks: t,
    transactions: tx,
  });
}
