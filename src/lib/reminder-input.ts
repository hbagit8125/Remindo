import { isoDay } from "./day";
import { z } from "zod";
import { config, DEFAULT_LEAD_TIMES } from "./config";
import { localToUtc } from "./time";

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

/**
 * The editable shape of a reminder. The AI parser, the manual form and the edit
 * form all produce this, and the server turns it into a stored reminder.
 */
export const reminderInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).nullish(),
  date: isoDay(),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "time must be HH:mm")
    .nullish(),
  recurrence: z.enum(["none", "daily", "weekly", "monthly", "yearly"]).default("none"),
  /** Monthly: the day you mean (e.g. 31) when the first date falls on a shorter month's last day. */
  monthDay: z.number().int().min(1).max(31).nullish(),
  interval: z.coerce.number().int().min(1).max(365).default(1),
  weekdays: z.array(z.enum(WEEKDAYS)).nullish(),
  until: isoDay()
    .nullish(),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  category: z.string().trim().max(50).nullish(),
  /** Bill amount in rupees, if this reminder is for a payment. */
  amount: z.coerce.number().positive().max(100_000_000).nullish(),
  /** Minutes before the time to alert. null/undefined = defaults for the priority. */
  leadTimes: z.array(z.coerce.number().int().min(0).max(60 * 24 * 60)).nullish(),
});

export type ReminderInput = z.infer<typeof reminderInputSchema>;

export function buildRrule(i: ReminderInput): string | null {
  if (i.recurrence === "none") return null;
  const parts = [`FREQ=${i.recurrence.toUpperCase()}`, `INTERVAL=${i.interval || 1}`];
  if (i.recurrence === "weekly" && i.weekdays?.length) parts.push(`BYDAY=${i.weekdays.join(",")}`);
  // "Every month on the 31st" would skip shorter months; use the last day of those months instead.
  const day = i.monthDay || Number(i.date.slice(8, 10));
  if (i.recurrence === "monthly" && day >= 29) {
    const days = Array.from({ length: day - 27 }, (_, k) => 28 + k).join(",");
    parts.push(`BYMONTHDAY=${days}`, "BYSETPOS=-1");
  }
  if (i.until) parts.push(`UNTIL=${i.until.replace(/-/g, "")}T235959Z`);
  return parts.join(";");
}

/** Convert input to the columns stored on a reminder row. */
export function inputToRow(i: ReminderInput) {
  const allDay = !i.time;
  const leadTimes = [...new Set(i.leadTimes?.length ? i.leadTimes : DEFAULT_LEAD_TIMES[i.priority])].sort(
    (a, b) => b - a,
  );
  return {
    title: i.title,
    notes: i.notes || null,
    dueAt: localToUtc(i.date, i.time || config.allDayHour),
    allDay,
    rrule: buildRrule(i),
    priority: i.priority,
    category: i.category || null,
    amountPaise: i.amount ? Math.round(i.amount * 100) : null,
    leadTimes,
    input: i,
  };
}

export function describeLead(min: number) {
  if (min === 0) return "at the time";
  if (min % 10080 === 0) return `${min / 10080} week${min === 10080 ? "" : "s"} before`;
  if (min % 1440 === 0) return `${min / 1440} day${min === 1440 ? "" : "s"} before`;
  if (min % 60 === 0) return `${min / 60} hour${min === 60 ? "" : "s"} before`;
  return `${min} min before`;
}
