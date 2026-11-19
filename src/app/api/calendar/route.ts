import { NextResponse } from "next/server";
import { and, gte, lte } from "drizzle-orm";
import { db, transactions } from "@/db";
import { agenda } from "@/lib/scheduler";
import { tasksDueBetween } from "@/lib/tasks";
import { fmtLocal, localToUtc } from "@/lib/time";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Everything per day between ?from and ?to (YYYY-MM-DD, at most ~6 weeks):
 * reminder occurrences, tasks due, money in/out.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  if (!DAY.test(from) || !DAY.test(to) || from > to) return NextResponse.json({ error: "from/to must be YYYY-MM-DD" }, { status: 400 });
  const start = localToUtc(from, "00:00");
  const end = new Date(localToUtc(to, "00:00").getTime() + 86400000 - 1);
  if (end.getTime() - start.getTime() > 45 * 86400000) return NextResponse.json({ error: "Range too long" }, { status: 400 });

  const [items, due, tx] = await Promise.all([
    agenda(start, end),
    tasksDueBetween(from, to),
    db().select().from(transactions).where(and(gte(transactions.date, from), lte(transactions.date, to))),
  ]);

  const days: Record<
    string,
    { reminders: typeof items; tasks: typeof due; transactions: typeof tx; spent: number; income: number }
  > = {};
  const bucket = (d: string) => (days[d] ??= { reminders: [], tasks: [], transactions: [], spent: 0, income: 0 });
  for (const i of items) bucket(fmtLocal(new Date(i.occurrenceAt), "yyyy-MM-dd")).reminders.push(i);
  for (const t of due) bucket(t.dueDate!).tasks.push(t);
  for (const t of tx) {
    const b = bucket(t.date);
    b.transactions.push(t);
    if (t.type === "expense") b.spent += t.amountPaise;
    else b.income += t.amountPaise;
  }
  return NextResponse.json({ from, to, days });
}
