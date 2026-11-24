import { connection, NextResponse } from "next/server";
import { checkWidgetKey } from "@/lib/widget";
import { agenda } from "@/lib/scheduler";
import { focusFrom, listTasks } from "@/lib/tasks";
import { listTransactions } from "@/lib/finance";
import { formatINR } from "@/lib/money";
import { fmtLocal, localDayBounds } from "@/lib/time";

/**
 * Today's list for the Android widget. Uses the widget key (?k=…), not your login,
 * and returns only what the widget shows.
 */
export async function GET(req: Request) {
  await connection();
  const k = new URL(req.url).searchParams.get("k");
  if (!(await checkWidgetKey(k))) return NextResponse.json({ error: "Widget link is invalid. Set it up again from Remindo → More." }, { status: 401 });

  const now = new Date();
  const today = localDayBounds(now);
  const [items, tasks, tx] = await Promise.all([agenda(today.start, today.end), listTasks(now), listTransactions(fmtLocal(now, "yyyy-MM"))]);
  const todayKey = fmtLocal(now, "yyyy-MM-dd");
  const spent = tx.filter((t) => t.type === "expense" && t.date === todayKey).reduce((a, t) => a + t.amountPaise, 0);
  const reminders = items
    .sort((a, b) => Number(a.allDay) - Number(b.allDay) || a.occurrenceAt.localeCompare(b.occurrenceAt))
    .map((i) => ({
      title: i.title,
      time: i.allDay ? "All day" : fmtLocal(new Date(i.occurrenceAt), "h:mm a"),
      done: i.done,
      high: i.priority === "high",
      past: !i.done && !i.allDay && new Date(i.occurrenceAt) < now,
    }));
  const focus = focusFrom(tasks, now).map((t) => ({ title: t.title, done: t.done, high: t.priority === "high" }));
  return NextResponse.json(
    {
      date: fmtLocal(now, "EEE d MMM"),
      updated: fmtLocal(now, "h:mm a"),
      reminders,
      tasks: focus,
      left: reminders.filter((r) => !r.done).length + focus.filter((t) => !t.done).length,
      spentToday: spent ? formatINR(spent) : null,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
