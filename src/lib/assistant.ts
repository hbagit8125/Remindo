import { isoDay } from "./day";
import { and, eq, gte, ilike, isNull, lte, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db, dues, reminders, tasks, transactions } from "@/db";
import { agenda, completeOccurrence, snoozeOccurrence, cancelQueued, planAndQueue } from "./scheduler";
import { occurrencesBetween } from "./recurrence";
import { focusFrom, listTasks, updateTask } from "./tasks";
import { listAccounts, listDues, listGoals, settleDue } from "./moneyplus";
import { getBudgets, logReminderPayment, summarize } from "./finance";
import { formatINR, TOTAL_BUDGET } from "./money";
import { fmtLocal, localDayBounds, localToUtc } from "./time";
import { inputToRow, type ReminderInput } from "./reminder-input";
import { sql } from "drizzle-orm";

const day = isoDay();

/** A question about your own data. The AI fills this in; the numbers come from the database. */
export const questionSchema = z.object({
  kind: z.enum(["spend", "income", "agenda", "find", "tasks", "balance", "goals", "dues", "budget"]),
  category: z.string().max(40).nullish(),
  /** Free-text filter: merchant, note words, or the thing to find ("Ammu's birthday"). */
  keyword: z.string().max(80).nullish(),
  from: day.nullish(),
  to: day.nullish(),
});
export type Question = z.infer<typeof questionSchema>;

/** A change to something that already exists. Always confirmed by you before it runs. */
export const commandSchema = z.object({
  action: z.enum(["complete", "snooze", "reschedule", "delete", "log_payment", "settle_due"]),
  /** Words identifying the reminder or task, e.g. "dentist", "rent"; for settle_due, the person. */
  target: z.string().min(1).max(80),
  date: day.nullish(),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullish(),
  minutes: z.coerce.number().int().min(1).max(60 * 24 * 14).nullish(),
});
export type Command = z.infer<typeof commandSchema>;

export type Answer = { text: string; lines?: string[] };

/** "Snooze to tomorrow 10am" → minutes from now until then; otherwise the given minutes (default 60). */
export function snoozeMinutes(c: { date?: string | null; time?: string | null; minutes?: number | null }, now = new Date()) {
  if (c.date || c.time) {
    let until = localToUtc(c.date || fmtLocal(now, "yyyy-MM-dd"), c.time || "09:00");
    // "Snooze to 10am" said after 10am means tomorrow.
    if (!c.date && until <= now) until = new Date(until.getTime() + 86400000);
    return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60000));
  }
  return c.minutes || 60;
}

const monthStart = (now: Date) => `${fmtLocal(now, "yyyy-MM")}-01`;
const today = (now: Date) => fmtLocal(now, "yyyy-MM-dd");
const pretty = (d: string) => fmtLocal(new Date(`${d}T12:00:00Z`), "d MMM yyyy");
function rangeLabel(from: string, to: string, now: Date) {
  if (from === monthStart(now) && to === today(now)) return "this month";
  if (from === to) return `on ${pretty(from)}`;
  const f = new Date(`${from}T12:00:00Z`);
  const t = new Date(`${to}T12:00:00Z`);
  const lastDay = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0)).getUTCDate();
  if (from.endsWith("-01") && to.slice(0, 7) === from.slice(0, 7) && Number(to.slice(8)) === lastDay) return `in ${fmtLocal(f, "MMMM yyyy")}`;
  return `from ${fmtLocal(f, "d MMM")} to ${fmtLocal(t, "d MMM yyyy")}`;
}

/** Answer a question exactly from the database. */
export async function answerQuestion(q: Question, now = new Date()): Promise<Answer> {
  switch (q.kind) {
    case "spend":
    case "income": {
      const from = q.from || monthStart(now);
      const to = q.to || today(now);
      const conds = [eq(transactions.type, q.kind === "spend" ? "expense" : "income"), gte(transactions.date, from), lte(transactions.date, to)];
      if (q.category) conds.push(ilike(transactions.category, q.category));
      if (q.keyword) {
        const like = `%${q.keyword}%`;
        conds.push(or(ilike(transactions.note, like), ilike(transactions.merchant, like), ilike(transactions.category, like))!);
      }
      const rows = await db().select().from(transactions).where(and(...conds));
      const total = rows.reduce((s, r) => s + r.amountPaise, 0);
      const what = [q.category, q.keyword].filter(Boolean).join(" / ");
      const verb = q.kind === "spend" ? "spent" : "received";
      if (!rows.length) return { text: `You haven't ${verb} anything${what ? ` on ${what}` : ""} ${rangeLabel(from, to, now)}.` };
      const top = [...rows].sort((a, b) => b.amountPaise - a.amountPaise).slice(0, 5);
      return {
        text: `You ${verb} ${formatINR(total)}${what ? ` on ${what}` : ""} ${rangeLabel(from, to, now)}, across ${rows.length} entr${rows.length === 1 ? "y" : "ies"}.`,
        lines: q.category || q.keyword
          ? top.map((r) => `${fmtLocal(new Date(`${r.date}T12:00:00Z`), "d MMM")} · ${r.note || r.category} · ${formatINR(r.amountPaise)}`)
          : summarize("", rows).byCategory.slice(0, 5).map((c) => `${c.category}: ${formatINR(c.amount)}`),
      };
    }
    case "agenda": {
      // "What's due this week?" means from today on, unless the whole range is in the past.
      const to0 = q.to || null;
      const from = !q.from || (q.from < today(now) && (!to0 || to0 >= today(now))) ? today(now) : q.from;
      const to = q.to || fmtLocal(new Date(now.getTime() + 6 * 86400000), "yyyy-MM-dd");
      const items = (await agenda(localToUtc(from, "00:00"), new Date(localToUtc(to, "00:00").getTime() + 86400000 - 1))).filter((i) => !i.done);
      const due = (await db().select().from(tasks).where(and(eq(tasks.done, false), gte(tasks.dueDate, from), lte(tasks.dueDate, to)))).filter(Boolean);
      if (!items.length && !due.length) return { text: `Nothing due ${from === to ? pretty(from) : rangeLabel(from, to, now)}. 🎉` };
      return {
        text: `${items.length} reminder${items.length === 1 ? "" : "s"}${due.length ? ` and ${due.length} task${due.length === 1 ? "" : "s"}` : ""} ${from === to && from === today(now) ? "today" : rangeLabel(from, to, now)}:`,
        lines: [
          ...items.map((i) => `${fmtLocal(new Date(i.occurrenceAt), i.allDay ? "EEE d MMM" : "EEE d MMM, h:mm a")} · ${i.title}${i.amountPaise ? ` · ${formatINR(i.amountPaise)}` : ""}`),
          ...due.map((t) => `${fmtLocal(new Date(`${t.dueDate}T12:00:00Z`), "EEE d MMM")} · ☐ ${t.title}`),
        ],
      };
    }
    case "find": {
      const kw = (q.keyword || "").trim();
      if (!kw) return { text: "What should I look for?" };
      const words = kw.split(/\s+/).filter((w) => w.length > 2 && !/^(the|and|for|my|of)$/i.test(w));
      const like = (w: string) => ilike(reminders.title, `%${w.replace(/'s$/i, "")}%`);
      const rows = await db()
        .select()
        .from(reminders)
        .where(and(ne(reminders.status, "archived"), ...(words.length ? words.map(like) : [like(kw)])));
      if (!rows.length) return { text: `I couldn't find a reminder matching “${kw}”.` };
      const horizon = new Date(now.getTime() + 400 * 86400000);
      const lines = rows.slice(0, 5).map((r) => {
        const next = occurrencesBetween(r, now, horizon)[0];
        if (!next) return `${r.title}: ${r.status === "done" ? "done" : "no upcoming date"}`;
        const days = Math.round((localDayBounds(next).start.getTime() - localDayBounds(now).start.getTime()) / 86400000);
        return `${r.title}: ${fmtLocal(next, r.allDay ? "EEE, d MMM yyyy" : "EEE, d MMM yyyy · h:mm a")} (${days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`})`;
      });
      return { text: lines[0], lines: lines.slice(1) };
    }
    case "tasks": {
      const all = await listTasks(now);
      const open = all.filter((t) => !t.done);
      const focus = focusFrom(all, now).filter((t) => !t.done);
      if (!open.length) return { text: "No open tasks. 🎉" };
      return {
        text: `${open.length} open task${open.length === 1 ? "" : "s"}${focus.length ? `, ${focus.length} in today's focus` : ""}:`,
        lines: open.slice(0, 10).map((t) => `${focus.find((f) => f.id === t.id) ? "⭐" : "☐"} ${t.title}${t.dueDate ? ` · due ${pretty(t.dueDate)}` : ""}`),
      };
    }
    case "balance": {
      const accs = await listAccounts();
      if (!accs.length) return { text: "You haven't added any accounts yet (Money → Accounts)." };
      const total = accs.filter((a) => a.kind !== "card").reduce((s, a) => s + a.balancePaise, 0);
      return { text: `Total balance: ${formatINR(total)}`, lines: accs.map((a) => `${a.name}: ${formatINR(a.balancePaise)}`) };
    }
    case "goals": {
      const gs = await listGoals(now);
      if (!gs.length) return { text: "No savings goals yet (Money → Goals)." };
      return {
        text: `${gs.length} goal${gs.length === 1 ? "" : "s"}:`,
        lines: gs.map((g) => `${g.emoji || "🎯"} ${g.name}: ${formatINR(g.savedPaise)} of ${formatINR(g.targetPaise)}${g.perMonthPaise ? ` · ${formatINR(g.perMonthPaise)}/month to go` : ""}`),
      };
    }
    case "dues": {
      const d = await listDues();
      if (!d.open.length) return { text: "Nobody owes you anything, and you don't owe anyone. All square." };
      return {
        text: `Others owe you ${formatINR(d.theyOwe)}; you owe ${formatINR(d.iOwe)}.`,
        lines: d.open.map((x) => `${x.direction === "they_owe" ? `${x.person} owes you` : `You owe ${x.person}`} ${formatINR(x.amountPaise)}${x.note ? ` · ${x.note}` : ""}`),
      };
    }
    case "budget": {
      const b = await getBudgets();
      const limit = b[TOTAL_BUDGET];
      const month = fmtLocal(now, "yyyy-MM");
      const rows = await db().select().from(transactions).where(and(gte(transactions.date, `${month}-01`), lte(transactions.date, today(now))));
      const s = summarize(month, rows);
      if (!limit) return { text: `No budget set. You've spent ${formatINR(s.spent)} this month.` };
      const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
      const daysLeft = last - Number(today(now).slice(8)) + 1;
      return {
        text:
          s.spent <= limit
            ? `${formatINR(limit - s.spent)} left of your ${formatINR(limit)} budget. About ${formatINR(Math.floor((limit - s.spent) / daysLeft / 100) * 100)} a day for ${daysLeft} days.`
            : `You're ${formatINR(s.spent - limit)} over your ${formatINR(limit)} budget this month.`,
      };
    }
  }
}

// ------------------------------------------------------------- commands

export type Candidate = {
  kind: "reminder" | "task" | "due";
  id: string;
  title: string;
  /** For reminders: the occurrence the action applies to. */
  occurrenceAt?: string;
  description: string;
  amountPaise?: number | null;
};

/** Find what a command refers to and describe the change, for you to confirm. */
export async function resolveCommand(c: Command, now = new Date()): Promise<Candidate[]> {
  const words = c.target
    .split(/\s+/)
    .map((w) => w.replace(/'s$/i, "").replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w.length > 2 && !/^(the|and|for|my|reminder|task|appointment)$/i.test(w));
  if (!words.length) return [];
  if (c.action === "settle_due") {
    const open = await db().select().from(dues).where(and(isNull(dues.settledAt), or(...words.map((w) => ilike(dues.person, `%${w}%`)))!));
    return open.map((d) => ({
      kind: "due" as const,
      id: d.id,
      title: d.person,
      amountPaise: d.amountPaise,
      description:
        d.direction === "they_owe"
          ? `${d.person} paid back ${formatINR(d.amountPaise)}${d.note ? ` (${d.note})` : ""}: close it and log it as Refund`
          : `You paid ${d.person} back ${formatINR(d.amountPaise)}${d.note ? ` (${d.note})` : ""}: close it and log the expense`,
    }));
  }
  const rRows = await db()
    .select()
    .from(reminders)
    .where(and(eq(reminders.status, "active"), or(...words.map((w) => ilike(reminders.title, `%${w}%`)))!));
  const tRows = c.action === "log_payment" ? [] : await db().select().from(tasks).where(and(eq(tasks.done, false), or(...words.map((w) => ilike(tasks.title, `%${w}%`)))!));
  const score = (title: string) => words.filter((w) => title.toLowerCase().includes(w.toLowerCase())).length;

  const out: Candidate[] = [];
  for (const r of rRows) {
    // Act on the most relevant occurrence: an overdue one in the last week, else the next one.
    const past = occurrencesBetween(r, new Date(now.getTime() - 7 * 86400000), now).at(-1);
    const next = occurrencesBetween(r, now, new Date(now.getTime() + 400 * 86400000))[0];
    const occ = c.action === "log_payment" || c.action === "complete" || c.action === "snooze" ? past || next : next || past;
    if (!occ && c.action !== "delete") continue;
    const when = occ ? fmtLocal(occ, r.allDay ? "EEE d MMM" : "EEE d MMM, h:mm a") : "";
    const desc =
      c.action === "complete"
        ? `Mark “${r.title}” (${when}) as done`
        : c.action === "snooze"
          ? `Snooze “${r.title}” ${c.date || c.time ? `until ${fmtLocal(new Date(now.getTime() + snoozeMinutes(c, now) * 60000), "EEE d MMM, h:mm a")}` : `by ${c.minutes || 60} min`}`
          : c.action === "reschedule"
            ? `Move “${r.title}”${r.rrule ? " (whole series)" : ""} to ${c.date ? pretty(c.date) : "the same day"}${c.time ? ` ${c.time}` : ""}`
            : c.action === "delete"
              ? `Delete “${r.title}”${r.rrule ? " and all its repeats" : ""}`
              : r.amountPaise
                ? `Log ${formatINR(r.amountPaise)} paid for “${r.title}”`
                : `“${r.title}” has no amount to log`;
    out.push({ kind: "reminder", id: r.id, title: r.title, occurrenceAt: occ?.toISOString(), description: desc, amountPaise: r.amountPaise });
  }
  for (const t of tRows) {
    if (c.action === "snooze") continue;
    const desc =
      c.action === "complete"
        ? `Tick off task “${t.title}”`
        : c.action === "reschedule"
          ? `Set task “${t.title}” due ${c.date ? pretty(c.date) : "(no date)"}`
          : `Delete task “${t.title}”`;
    out.push({ kind: "task", id: t.id, title: t.title, description: desc });
  }
  // Only offer the best matches, so a weaker match isn't one tap away.
  const usable = out.filter((x) => !(c.action === "log_payment" && !x.amountPaise));
  const best = Math.max(0, ...usable.map((x) => score(x.title)));
  return usable
    .filter((x) => score(x.title) === best)
    .sort((a, b) => a.title.length - b.title.length)
    .slice(0, 3);
}

export const executeSchema = z.object({
  action: commandSchema.shape.action,
  kind: z.enum(["reminder", "task", "due"]),
  id: z.string().uuid(),
  occurrenceAt: z.string().datetime().nullish(),
  date: day.nullish(),
  time: commandSchema.shape.time,
  minutes: commandSchema.shape.minutes,
});

/** Run a confirmed command. */
export async function executeCommand(x: z.infer<typeof executeSchema>, now = new Date()): Promise<string> {
  if (x.kind === "due") {
    const d = await settleDue(x.id, { log: true }, now);
    return d ? `Closed: ${d.person} ${d.direction === "they_owe" ? "paid you back" : "paid back"} ${formatINR(d.amountPaise)}` : "Already settled";
  }
  if (x.kind === "task") {
    if (x.action === "complete") return (await updateTask(x.id, { done: true }, now)) ? "Task done ✓" : "Task not found";
    if (x.action === "reschedule") return (await updateTask(x.id, { dueDate: x.date || null }, now)) ? "Task updated" : "Task not found";
    if (x.action === "delete") {
      const { deleteTask } = await import("./tasks");
      return (await deleteTask(x.id)) ? "Task deleted" : "Task not found";
    }
    return "That doesn't apply to tasks";
  }
  const [r] = await db().select().from(reminders).where(eq(reminders.id, x.id));
  if (!r) return "Reminder not found";
  const occ = x.occurrenceAt ? new Date(x.occurrenceAt) : r.dueAt;
  switch (x.action) {
    case "complete":
      await completeOccurrence(r.id, occ);
      return `“${r.title}” marked done`;
    case "snooze": {
      const until = await snoozeOccurrence(r.id, occ, snoozeMinutes(x, now));
      return `Snoozed until ${until ? fmtLocal(until, until.getTime() - now.getTime() > 20 * 3600000 ? "EEE d MMM, h:mm a" : "h:mm a") : "later"}`;
    }
    case "log_payment": {
      const res = await logReminderPayment(r.id, occ);
      return "transaction" in res && res.transaction ? `${formatINR(res.transaction.amountPaise)} logged` : "Nothing to log";
    }
    case "delete": {
      const { deleteReminders } = await import("./create");
      await deleteReminders([r.id]);
      return `“${r.title}” deleted`;
    }
    case "reschedule": {
      const input = (r.input as ReminderInput) || null;
      const base: ReminderInput = input || {
        title: r.title,
        notes: r.notes,
        date: fmtLocal(r.dueAt, "yyyy-MM-dd"),
        time: r.allDay ? null : fmtLocal(r.dueAt, "HH:mm"),
        recurrence: "none",
        interval: 1,
        priority: r.priority as ReminderInput["priority"],
        category: r.category,
        leadTimes: r.leadTimes,
      };
      const next: ReminderInput = { ...base, date: x.date || base.date, time: x.time !== undefined && x.time !== null ? x.time : base.time };
      const { changeRow } = await import("./undo");
      await changeRow("reminders", r.id, `Moved “${r.title}”`, "edit", async () => {
        await cancelQueued(r.id);
        await db()
          .update(reminders)
          .set({ ...inputToRow(next), version: sql`${reminders.version} + 1`, updatedAt: new Date() })
          .where(eq(reminders.id, r.id));
      });
      await planAndQueue({ reminderIds: [r.id] });
      return `Moved to ${fmtLocal(localToUtc(next.date, next.time || "09:00"), next.time ? "EEE d MMM, h:mm a" : "EEE d MMM")}`;
    }
    default:
      return "Done"; // settle_due on a reminder can't happen
  }
}
