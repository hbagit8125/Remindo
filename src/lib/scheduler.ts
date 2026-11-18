import { and, eq, inArray, lt, gte, lte, ne } from "drizzle-orm";
import { db, reminders, deliveries, completions, type Reminder, type Delivery } from "@/db";
import { alertsBetween, occurrencesBetween, describeRrule } from "./recurrence";
import { qstashEnabled, scheduleDelivery } from "./qstash";
import { sendEmail, reminderEmail } from "./email";
import { signToken } from "./auth";
import { config } from "./config";
import { describeLead } from "./reminder-input";
import { fmtLocal } from "./time";

/** How far ahead alerts are queued. QStash free tier allows up to 7 days of delay. */
export const PLAN_AHEAD_MS = 48 * 3600 * 1000;
/** Alerts this recently due are still sent if they were missed. */
const GRACE_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------- planning

/** Create delivery rows for every alert in the window and queue the new ones. */
export async function planAndQueue(opts: { reminderIds?: string[]; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const from = new Date(now.getTime() - GRACE_MS);
  const to = new Date(now.getTime() + PLAN_AHEAD_MS);

  const where = opts.reminderIds?.length
    ? and(eq(reminders.status, "active"), inArray(reminders.id, opts.reminderIds))
    : eq(reminders.status, "active");
  const active = await db().select().from(reminders).where(where);

  const planned = active.flatMap((r) => alertsBetween(r, from, to));
  if (!planned.length) return { planned: 0, queued: 0 };

  // Skip occurrences already marked done.
  const done = await db()
    .select({ reminderId: completions.reminderId, occurrenceAt: completions.occurrenceAt })
    .from(completions)
    .where(inArray(completions.reminderId, [...new Set(planned.map((p) => p.reminderId))]));
  const doneSet = new Set(done.map((d) => `${d.reminderId}|${d.occurrenceAt.toISOString()}`));
  const todo = planned.filter((p) => !doneSet.has(`${p.reminderId}|${p.occurrenceAt.toISOString()}`));
  if (!todo.length) return { planned: planned.length, queued: 0 };

  const inserted = await db()
    .insert(deliveries)
    .values(todo.map((p) => ({ ...p, kind: "alert" })))
    .onConflictDoNothing({ target: deliveries.dedupeKey })
    .returning();

  let queued = 0;
  for (const d of inserted) {
    if (await queueDelivery(d, now)) queued++;
  }
  return { planned: planned.length, queued };
}

/** Send now if due, otherwise hand to QStash. Without QStash, the sweep sends it. */
export async function queueDelivery(d: Delivery, now = new Date()) {
  if (d.alertAt.getTime() <= now.getTime() + 60_000) {
    await sendDelivery(d.id);
    return true;
  }
  if (!qstashEnabled()) return false;
  try {
    const qstashId = await scheduleDelivery(d.id, d.alertAt);
    await db().update(deliveries).set({ qstashId }).where(eq(deliveries.id, d.id));
    return true;
  } catch (e) {
    await db().update(deliveries).set({ error: `qstash: ${(e as Error).message}` }).where(eq(deliveries.id, d.id));
    return false;
  }
}

/** Cancel queued alerts for a reminder (or one occurrence). QStash calls for them become no-ops. */
export async function cancelQueued(reminderId: string, occurrenceAt?: Date) {
  const conds = [eq(deliveries.reminderId, reminderId), eq(deliveries.status, "queued")];
  if (occurrenceAt) conds.push(eq(deliveries.occurrenceAt, occurrenceAt));
  await db().update(deliveries).set({ status: "cancelled" }).where(and(...conds));
}

// ---------------------------------------------------------------- sending

async function actionLinks(deliveryId: string) {
  const link = async (act: string) =>
    `${config.appUrl}/api/action?t=${await signToken({ did: deliveryId, act }, "14d")}`;
  return {
    done: await link("done"),
    snooze15: await link("snooze15"),
    snooze60: await link("snooze60"),
    tomorrow: await link("tomorrow"),
  };
}

function headlineFor(d: Delivery, r: Reminder) {
  if (d.kind === "escalation") return "Still pending";
  if (d.kind === "snooze") return "Snoozed reminder";
  if (d.leadMinutes === 0) return r.priority === "high" ? "Important · now" : "Now";
  return `Heads up · ${describeLead(d.leadMinutes)}`;
}

function whenText(r: Reminder, occ: Date) {
  const time = r.allDay ? fmtLocal(occ, "EEEE, d MMM yyyy") : fmtLocal(occ, "EEEE, d MMM yyyy · h:mm a");
  const rep = describeRrule(r.rrule);
  return rep ? `${time} · ${rep}` : time;
}

/**
 * Send one delivery. Claims the row first so QStash and the sweep can never
 * send the same alert twice.
 */
export async function sendDelivery(deliveryId: string): Promise<"sent" | "skipped" | "failed"> {
  const [d] = await db()
    .update(deliveries)
    .set({ status: "sending" })
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.status, "queued")))
    .returning();
  if (!d) return "skipped";

  const [r] = await db().select().from(reminders).where(eq(reminders.id, d.reminderId));
  const [completed] = await db()
    .select({ id: completions.id })
    .from(completions)
    .where(and(eq(completions.reminderId, d.reminderId), eq(completions.occurrenceAt, d.occurrenceAt)));

  if (!r || r.status !== "active" || completed || !d.dedupeKey.startsWith(`${r.id}:v${r.version}:`)) {
    await db().update(deliveries).set({ status: "cancelled" }).where(eq(deliveries.id, d.id));
    return "skipped";
  }

  try {
    const headline = headlineFor(d, r);
    const subject = `${r.priority === "high" ? "❗ " : "⏰ "}${r.title}${d.leadMinutes > 0 && d.kind === "alert" ? ` · ${describeLead(d.leadMinutes)}` : ""}`;
    await sendEmail(
      subject,
      reminderEmail({
        title: r.title,
        notes: r.notes,
        priority: r.priority,
        whenText: whenText(r, d.occurrenceAt),
        headline,
        links: await actionLinks(d.id),
      }),
    );
    await db()
      .update(deliveries)
      .set({ status: "sent", sentAt: new Date(), attempts: d.attempts + 1, error: null })
      .where(eq(deliveries.id, d.id));
    await maybeEscalate(d, r);
    return "sent";
  } catch (e) {
    const attempts = d.attempts + 1;
    await db()
      .update(deliveries)
      .set({ status: attempts >= 5 ? "failed" : "queued", attempts, error: (e as Error).message })
      .where(eq(deliveries.id, d.id));
    return "failed";
  }
}

/** High-priority reminders re-send until marked done or snoozed. */
async function maybeEscalate(d: Delivery, r: Reminder) {
  if (r.priority !== "high") return;
  if (d.kind === "alert" && d.leadMinutes !== 0) return;
  const level = d.kind === "escalation" ? Number(d.dedupeKey.split(":E").pop()) || 1 : 0;
  if (level >= config.maxEscalations) return;
  const base = d.kind === "escalation" ? d.dedupeKey.replace(/:E\d+$/, "") : d.dedupeKey;
  const alertAt = new Date(Date.now() + config.escalateAfterMin * 60000);
  const [row] = await db()
    .insert(deliveries)
    .values({
      reminderId: r.id,
      occurrenceAt: d.occurrenceAt,
      alertAt,
      leadMinutes: 0,
      kind: "escalation",
      dedupeKey: `${base}:E${level + 1}`,
    })
    .onConflictDoNothing({ target: deliveries.dedupeKey })
    .returning();
  if (row) await queueDelivery(row);
}

// ---------------------------------------------------------------- actions

export async function completeOccurrence(reminderId: string, occurrenceAt: Date) {
  await db().insert(completions).values({ reminderId, occurrenceAt }).onConflictDoNothing();
  await cancelQueued(reminderId, occurrenceAt);
  const [r] = await db().select().from(reminders).where(eq(reminders.id, reminderId));
  if (r && !r.rrule) {
    await db().update(reminders).set({ status: "done", updatedAt: new Date() }).where(eq(reminders.id, reminderId));
  }
  return r;
}

export async function uncompleteOccurrence(reminderId: string, occurrenceAt: Date) {
  await db()
    .delete(completions)
    .where(and(eq(completions.reminderId, reminderId), eq(completions.occurrenceAt, occurrenceAt)));
  const [r] = await db().select().from(reminders).where(eq(reminders.id, reminderId));
  if (r && !r.rrule && r.status === "done") {
    await db().update(reminders).set({ status: "active", updatedAt: new Date() }).where(eq(reminders.id, reminderId));
  }
}

export async function snoozeOccurrence(reminderId: string, occurrenceAt: Date, minutes: number) {
  // Snoozing replaces any pending escalations for this occurrence.
  await db()
    .update(deliveries)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(deliveries.reminderId, reminderId),
        eq(deliveries.occurrenceAt, occurrenceAt),
        eq(deliveries.status, "queued"),
        ne(deliveries.kind, "alert"),
      ),
    );
  const [r] = await db().select().from(reminders).where(eq(reminders.id, reminderId));
  if (!r) return null;
  const alertAt = new Date(Date.now() + minutes * 60000);
  const [row] = await db()
    .insert(deliveries)
    .values({
      reminderId,
      occurrenceAt,
      alertAt,
      leadMinutes: 0,
      kind: "snooze",
      dedupeKey: `${r.id}:v${r.version}:${occurrenceAt.toISOString()}:S${alertAt.getTime()}`,
    })
    .returning();
  await queueDelivery(row);
  return alertAt;
}

// ---------------------------------------------------------------- sweep

/** Safety net: send anything overdue that never went out, and plan the window. */
export async function sweep(now = new Date()) {
  const plan = await planAndQueue({ now });
  const stuck = await db()
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.status, "queued"),
        lt(deliveries.alertAt, new Date(now.getTime() - 2 * 60000)),
        gte(deliveries.alertAt, new Date(now.getTime() - 24 * 3600 * 1000)),
      ),
    )
    .limit(25);
  let resent = 0;
  for (const s of stuck) if ((await sendDelivery(s.id)) === "sent") resent++;
  return { ...plan, resent };
}

// ---------------------------------------------------------------- agenda

export type AgendaItem = {
  reminderId: string;
  occurrenceAt: string;
  title: string;
  notes: string | null;
  priority: string;
  category: string | null;
  allDay: boolean;
  recurring: string;
  done: boolean;
  snoozedUntil: string | null;
};

/** Occurrences between two instants, with done/snooze state. */
export async function agenda(from: Date, to: Date): Promise<AgendaItem[]> {
  const rows = await db().select().from(reminders).where(inArray(reminders.status, ["active", "done"]));
  const items: AgendaItem[] = [];
  for (const r of rows) {
    for (const occ of occurrencesBetween(r, from, to)) {
      items.push({
        reminderId: r.id,
        occurrenceAt: occ.toISOString(),
        title: r.title,
        notes: r.notes,
        priority: r.priority,
        category: r.category,
        allDay: r.allDay,
        recurring: describeRrule(r.rrule),
        done: r.status === "done",
        snoozedUntil: null,
      });
    }
  }
  if (!items.length) return items;

  const ids = [...new Set(items.map((i) => i.reminderId))];
  const comps = await db()
    .select()
    .from(completions)
    .where(and(inArray(completions.reminderId, ids), gte(completions.occurrenceAt, from), lte(completions.occurrenceAt, to)));
  const doneSet = new Set(comps.map((c) => `${c.reminderId}|${c.occurrenceAt.toISOString()}`));
  const snoozes = await db()
    .select()
    .from(deliveries)
    .where(and(inArray(deliveries.reminderId, ids), eq(deliveries.kind, "snooze"), eq(deliveries.status, "queued")));
  const snoozeMap = new Map(snoozes.map((s) => [`${s.reminderId}|${s.occurrenceAt.toISOString()}`, s.alertAt.toISOString()]));

  for (const i of items) {
    const k = `${i.reminderId}|${i.occurrenceAt}`;
    if (doneSet.has(k)) i.done = true;
    i.snoozedUntil = snoozeMap.get(k) ?? null;
  }
  return items.sort((a, b) => a.occurrenceAt.localeCompare(b.occurrenceAt));
}
