import { agenda, type AgendaItem } from "./scheduler";
import { digestSection, layout, sendEmail, type DigestItem } from "./email";
import { fmtLocal, localDayBounds } from "./time";
import { digestSpending, weeklySpending, listTransactions } from "./finance";
import { and, eq, gte } from "drizzle-orm";
import { db, deliveries, reminders, completions } from "@/db";
import { formatINR } from "./money";
import { sendTelegram, h } from "./telegram";
import { config } from "./config";

const when = (i: AgendaItem, withDay: boolean) => {
  const d = new Date(i.occurrenceAt);
  if (withDay) return i.allDay ? fmtLocal(d, "EEE d MMM") : fmtLocal(d, "EEE d MMM, h:mm a");
  return i.allDay ? "All day" : fmtLocal(d, "h:mm a");
};
const toItem = (withDay: boolean) => (i: AgendaItem): DigestItem => ({
  title: i.title,
  when: when(i, withDay),
  priority: i.priority,
  tag: i.recurring ? "↻" : i.category || undefined,
});

/** Morning email: today, overdue, and important dates in the next week. */
export async function sendDailyDigest(now = new Date()) {
  const today = localDayBounds(now);
  const week = await agenda(new Date(today.start.getTime() - 7 * 86400000), new Date(today.start.getTime() + 8 * 86400000));

  const overdue = week.filter((i) => !i.done && new Date(i.occurrenceAt) < today.start);
  const todays = week.filter((i) => new Date(i.occurrenceAt) >= today.start && new Date(i.occurrenceAt) < today.end && !i.done);
  const important = week.filter((i) => i.priority === "high" && !i.done && new Date(i.occurrenceAt) >= today.end);

  // Alerts that quiet hours kept off your phone overnight.
  const held = await db()
    .select({ title: reminders.title, priority: reminders.priority, alertAt: deliveries.alertAt })
    .from(deliveries)
    .innerJoin(reminders, eq(deliveries.reminderId, reminders.id))
    .where(and(eq(deliveries.held, true), gte(deliveries.sentAt, new Date(now.getTime() - 12 * 3600 * 1000))));

  const body =
    digestSection(
      "While you slept",
      held.map((x) => ({ title: x.title, when: fmtLocal(x.alertAt, "h:mm a"), priority: x.priority })),
    ) +
    digestSection("Overdue", overdue.map(toItem(true))) +
    digestSection(`Today · ${fmtLocal(now, "EEEE d MMM")}`, todays.map(toItem(false)), "Nothing scheduled. Enjoy the day!") +
    digestSection("Important this week", important.map(toItem(true))) +
    (await digestSpending(now).catch(() => ""));

  const count = todays.length;
  const subject = `☀️ Today: ${count} reminder${count === 1 ? "" : "s"}${overdue.length ? ` · ${overdue.length} overdue` : ""}${important.length ? ` · ${important.length} important ahead` : ""}`;
  await sendEmail(subject, layout(`Good morning! Here's your ${fmtLocal(now, "EEEE")}.`, body));
  await sendTelegram(
    [
      `☀️ <b>Good morning!</b> ${count ? `${count} reminder${count === 1 ? "" : "s"} today` : "Nothing scheduled today"}${overdue.length ? `, ${overdue.length} overdue` : ""}.`,
      ...todays.slice(0, 8).map((i) => `• ${when(i, false)} · ${h(i.title)}`),
      ...(important.length ? ["", "<b>Coming up</b>", ...important.slice(0, 3).map((i) => `❗ ${when(i, true)} · ${h(i.title)}`)] : []),
    ].join("\n"),
  ).catch(() => null);
  return { today: count, overdue: overdue.length, important: important.length, held: held.length };
}

/** Sunday evening email: the week ahead, grouped by day. */
export async function sendWeeklyPreview(now = new Date()) {
  const start = localDayBounds(now, 1).start;
  const items = (await agenda(start, new Date(start.getTime() + 7 * 86400000))).filter((i) => !i.done);
  let body = "";
  for (let d = 0; d < 7; d++) {
    const { start: s, end: e } = localDayBounds(start, d);
    const dayItems = items.filter((i) => new Date(i.occurrenceAt) >= s && new Date(i.occurrenceAt) < e);
    body += digestSection(fmtLocal(s, "EEEE d MMM"), dayItems.map(toItem(false)), "Free");
  }
  body += await weeklySpending(now).catch(() => "");
  const high = items.filter((i) => i.priority === "high").length;
  await sendEmail(
    `🗓️ Week ahead: ${items.length} reminder${items.length === 1 ? "" : "s"}${high ? ` · ${high} important` : ""}`,
    layout("Your week ahead", body),
  );
  return { items: items.length };
}

/** ~9pm email: what got done, what carries over, tomorrow, and today's spending. */
export async function sendEveningReview(now = new Date()) {
  const today = localDayBounds(now);
  const tomorrow = localDayBounds(now, 1);
  const items = await agenda(new Date(today.start.getTime() - 7 * 86400000), tomorrow.end);
  const inToday = (i: AgendaItem) => new Date(i.occurrenceAt) >= today.start && new Date(i.occurrenceAt) < today.end;

  const done = items.filter((i) => inToday(i) && i.done);
  const carried = items.filter((i) => !i.done && new Date(i.occurrenceAt) < today.end);
  const next = items.filter((i) => new Date(i.occurrenceAt) >= tomorrow.start && new Date(i.occurrenceAt) < tomorrow.end);

  // Also count things finished today that were due on other days.
  const doneOther = await db()
    .select({ id: completions.id })
    .from(completions)
    .where(gte(completions.completedAt, today.start));

  const dayStr = fmtLocal(now, "yyyy-MM-dd");
  const tx = (await listTransactions(fmtLocal(now, "yyyy-MM"))).filter((t) => t.date === dayStr);
  const spent = tx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amountPaise, 0);
  const earned = tx.filter((t) => t.type === "income").reduce((s, t) => s + t.amountPaise, 0);

  const spendHtml = `<h2 style="font-size:14px;margin:20px 0 4px;color:#374151">Money today</h2>
    <p style="font-size:14px;margin:0;color:#374151"><b>${formatINR(spent)}</b> spent${earned ? ` · <span style="color:#059669">${formatINR(earned)} received</span>` : ""} · ${tx.length} entr${tx.length === 1 ? "y" : "ies"}</p>
    ${tx
      .filter((t) => t.type === "expense")
      .slice(0, 8)
      .map((t) => `<div style="font-size:13px;color:#6b7280;margin-top:4px">${t.note || t.category} · ${formatINR(t.amountPaise)}</div>`)
      .join("")}`;

  const body =
    digestSection(`Done today · ${Math.max(done.length, doneOther.length)}`, done.map(toItem(false)), "Nothing ticked off today.") +
    digestSection("Carried to tomorrow", carried.map(toItem(true))) +
    digestSection(`Tomorrow · ${fmtLocal(tomorrow.start, "EEEE d MMM")}`, next.map(toItem(false)), "Nothing scheduled yet.") +
    spendHtml +
    `<p style="font-size:13px;color:#6b7280;margin-top:20px">Forgot to log something? <a href="${config.appUrl}" style="color:#6366f1">Add it now</a>.</p>`;

  const doneCount = Math.max(done.length, doneOther.length);
  await sendEmail(
    `🌙 Today: ${doneCount} done${carried.length ? ` · ${carried.length} pending` : ""} · ${formatINR(spent)} spent`,
    layout("Your day in review", body),
  );
  await sendTelegram(
    [
      `🌙 <b>Day in review</b>: ${doneCount} done${carried.length ? `, ${carried.length} pending` : ""}, ${formatINR(spent)} spent.`,
      ...(carried.length ? ["", "<b>Still pending</b>", ...carried.slice(0, 6).map((i) => `• ${h(i.title)}`)] : []),
      ...(next.length ? ["", "<b>Tomorrow</b>", ...next.slice(0, 6).map((i) => `• ${when(i, false)} · ${h(i.title)}`)] : []),
    ].join("\n"),
  ).catch(() => null);
  return { done: doneCount, carried: carried.length, tomorrow: next.length, spent };
}
