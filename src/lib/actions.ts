import { eq } from "drizzle-orm";
import { db, deliveries, reminders } from "@/db";
import { completeOccurrence, snoozeOccurrence, type Via } from "./scheduler";
import { logReminderPayment } from "./finance";
import { formatINR } from "./money";
import { config } from "./config";
import { fmtLocal, localToUtc } from "./time";

export const ACTIONS = ["done", "snooze15", "snooze60", "tomorrow", "log"] as const;
export type ActionName = (typeof ACTIONS)[number];

export type ActionResult = {
  ok: boolean;
  title: string;
  message: string;
  /** Bill amount (paise) that can still be logged after "done". */
  canLog?: number;
};

/**
 * Done / snooze / log for one alert. Shared by email links, push notification
 * buttons and Telegram buttons so they all behave the same.
 */
export async function performAction(deliveryId: string, act: ActionName, via: Via = "app"): Promise<ActionResult> {
  const [d] = await db().select().from(deliveries).where(eq(deliveries.id, deliveryId));
  if (!d) return { ok: false, title: "Not found", message: "This reminder no longer exists." };
  const [r] = await db().select().from(reminders).where(eq(reminders.id, d.reminderId));
  if (!r) return { ok: false, title: "Not found", message: "This reminder was deleted." };

  if (act === "done") {
    const [{ completions }, { and: andOp }] = await Promise.all([import("@/db"), import("drizzle-orm")]);
    const [already] = await db()
      .select()
      .from(completions)
      .where(andOp(eq(completions.reminderId, r.id), eq(completions.occurrenceAt, d.occurrenceAt)));
    if (already) {
      return { ok: true, title: "Already done", message: `"${r.title}" was already ticked off.`, canLog: r.amountPaise || undefined };
    }
    await completeOccurrence(r.id, d.occurrenceAt, via);
    return {
      ok: true,
      title: "Marked as done",
      message: `"${r.title}" is done. No more alerts for it${r.rrule ? " this time" : ""}.`,
      canLog: r.amountPaise || undefined,
    };
  }

  if (act === "log") {
    const res = await logReminderPayment(r.id, d.occurrenceAt);
    if ("error" in res && res.error) return { ok: false, title: "Couldn't log", message: res.error };
    if (!("transaction" in res) || !res.transaction) return { ok: false, title: "Couldn't log", message: "Something went wrong." };
    return {
      ok: true,
      title: res.already ? "Already logged" : "Payment logged",
      message: `${formatINR(res.transaction.amountPaise)} for "${r.title}" is in your expenses.`,
    };
  }

  let minutes = act === "snooze15" ? 15 : 60;
  if (act === "tomorrow") {
    const tomorrow = fmtLocal(new Date(Date.now() + 86400000), "yyyy-MM-dd");
    minutes = Math.max(1, Math.round((localToUtc(tomorrow, config.allDayHour).getTime() - Date.now()) / 60000));
  }
  const until = await snoozeOccurrence(r.id, d.occurrenceAt, minutes, via);
  return {
    ok: true,
    title: "Snoozed",
    message: `"${r.title}" will remind you again at ${until ? fmtLocal(until, "h:mm a, EEE d MMM") : "later"}.`,
  };
}
