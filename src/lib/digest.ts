import { agenda, type AgendaItem } from "./scheduler";
import { digestSection, layout, sendEmail, type DigestItem } from "./email";
import { fmtLocal, localDayBounds } from "./time";

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

  const body =
    digestSection("Overdue", overdue.map(toItem(true))) +
    digestSection(`Today · ${fmtLocal(now, "EEEE d MMM")}`, todays.map(toItem(false)), "Nothing scheduled. Enjoy the day!") +
    digestSection("Important this week", important.map(toItem(true)));

  const count = todays.length;
  const subject = `☀️ Today: ${count} reminder${count === 1 ? "" : "s"}${overdue.length ? ` · ${overdue.length} overdue` : ""}${important.length ? ` · ${important.length} important ahead` : ""}`;
  await sendEmail(subject, layout(`Good morning! Here's your ${fmtLocal(now, "EEEE")}.`, body));
  return { today: count, overdue: overdue.length, important: important.length };
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
  const high = items.filter((i) => i.priority === "high").length;
  await sendEmail(
    `🗓️ Week ahead: ${items.length} reminder${items.length === 1 ? "" : "s"}${high ? ` · ${high} important` : ""}`,
    layout("Your week ahead", body),
  );
  return { items: items.length };
}
