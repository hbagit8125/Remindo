import { NextResponse } from "next/server";
import { z } from "zod";
import { completeOccurrence, planAndQueue, snoozeOccurrence, uncompleteOccurrence } from "@/lib/scheduler";
import { logReminderPayment, paidOccurrences } from "@/lib/finance";

const schema = z.object({
  reminderId: z.string().uuid(),
  occurrenceAt: z.string().datetime(),
  action: z.enum(["done", "undo", "snooze", "log"]),
  minutes: z.number().int().min(1).max(60 * 24 * 7).optional(),
});

/** Done / undo / snooze for one occurrence, from the dashboard. */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const { reminderId, action, minutes } = parsed.data;
  const occ = new Date(parsed.data.occurrenceAt);

  if (action === "done") {
    const r = await completeOccurrence(reminderId, occ);
    // Bill reminders: let the app offer "Log ₹X as paid?"
    const paid = await paidOccurrences([reminderId]);
    const canLog = r?.amountPaise && !paid.has(`${reminderId}|${occ.toISOString()}`) ? r.amountPaise : null;
    return NextResponse.json({ ok: true, canLog });
  }
  if (action === "log") {
    const res = await logReminderPayment(reminderId, occ);
    if ("error" in res) return NextResponse.json(res, { status: 400 });
    return NextResponse.json(res);
  }
  if (action === "undo") {
    await uncompleteOccurrence(reminderId, occ);
    await planAndQueue({ reminderIds: [reminderId] });
  }
  if (action === "snooze") {
    const until = await snoozeOccurrence(reminderId, occ, minutes ?? 60);
    return NextResponse.json({ ok: true, snoozedUntil: until });
  }
  return NextResponse.json({ ok: true });
}
