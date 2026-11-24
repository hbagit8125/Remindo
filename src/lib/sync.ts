import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db, deliveries, type Reminder } from "@/db";
import { editTelegram, h } from "./telegram";
import { sendPush } from "./push";
import { fmtLocal } from "./time";
import type { Via } from "./scheduler";

type Change = { state: "done"; via: Via } | { state: "undone"; via: Via } | { state: "snoozed"; until: Date; via: Via };

const VIA_LABEL: Record<Via, string> = { app: "in Remindo", email: "from email", push: "from the notification", telegram: "on Telegram" };

/**
 * You ticked a reminder off (or snoozed / un-ticked it) in one place: bring the
 * other places in line.
 * - Telegram: every alert message for this occurrence loses its buttons and says so.
 * - Phone: the notification is replaced with a quiet "✓ Done" that clears itself.
 * - App: picks up the change on its next refresh (it polls while open).
 * - Email can't be changed once sent; its buttons show "Already done" if pressed later.
 */
export async function syncOccurrence(r: Reminder, occurrenceAt: Date, change: Change) {
  const rows = await db()
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.reminderId, r.id), eq(deliveries.occurrenceAt, occurrenceAt), ne(deliveries.status, "queued")));

  const tg = rows.filter((d) => d.tgChatId && d.tgMessageId);
  const text =
    change.state === "done"
      ? `✅ <s>${h(r.title)}</s>\nDone ${VIA_LABEL[change.via]}`
      : change.state === "snoozed"
        ? `😴 <b>${h(r.title)}</b>\nSnoozed until ${h(fmtLocal(change.until, "h:mm a, EEE d MMM"))}`
        : null;

  await Promise.allSettled([
    // Telegram messages
    ...tg.map(async (d) => {
      if (text) return editTelegram(d.tgChatId!, d.tgMessageId!, text);
      // Undone: restore the alert with its buttons.
      const { telegramAlertText, reminderKeyboard } = await import("./scheduler");
      return editTelegram(d.tgChatId!, d.tgMessageId!, telegramAlertText(r, "Not done yet", fmtLocal(occurrenceAt, "h:mm a, EEE d MMM")), reminderKeyboard(d.id, r.amountPaise));
    }),
    // Phone notification (skip when it was the notification itself that did it: it's already gone)
    (async () => {
      if (change.state === "undone" || change.via === "push" || !rows.some((d) => d.pushed)) return;
      await sendPush({
        title: change.state === "done" ? `✓ Done · ${r.title}` : `😴 Snoozed · ${r.title}`,
        body: change.state === "done" ? `Ticked off ${VIA_LABEL[change.via]}` : `Until ${fmtLocal(change.until, "h:mm a")}`,
        tag: `${r.id}:${occurrenceAt.toISOString()}`,
        url: "/",
        replace: true,
      });
    })(),
  ]);
}

/** Alerts for this occurrence that went to Telegram (used by tests). */
export function telegramAlerts(reminderId: string) {
  return db()
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.reminderId, reminderId), isNotNull(deliveries.tgMessageId)));
}
