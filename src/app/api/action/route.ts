import { eq } from "drizzle-orm";
import { db, deliveries, reminders } from "@/db";
import { signToken, verifyToken } from "@/lib/auth";
import { logReminderPayment } from "@/lib/finance";
import { formatINR } from "@/lib/money";
import { completeOccurrence, snoozeOccurrence } from "@/lib/scheduler";
import { esc } from "@/lib/email";
import { config } from "@/lib/config";
import { fmtLocal, localToUtc } from "@/lib/time";

function page(title: string, message: string, ok = true, extra = "") {
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b12;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#e5e7eb">
<div style="text-align:center;padding:32px;max-width:420px">
<div style="font-size:48px">${extra ? "⏰" : ok ? "✅" : "⚠️"}</div>
<h1 style="font-size:22px;margin:12px 0 8px">${esc(title)}</h1>
<p style="color:#9ca3af;font-size:15px;margin:0 0 24px">${esc(message)}</p>${extra}
<a href="${config.appUrl}" style="color:#a5b4fc;text-decoration:none;font-weight:600">Open dashboard →</a>
</div></body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } });
}

const LABELS: Record<string, string> = {
  done: "✓ Mark as done",
  snooze15: "Snooze 15 minutes",
  snooze60: "Snooze 1 hour",
  tomorrow: "Remind me tomorrow",
};

/**
 * Email links open a confirm page; the action only runs on the button's POST.
 * Mail scanners that pre-open links therefore can't mark things done by accident.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  const payload = await verifyToken<{ did: string; act: string }>(token);
  if (!payload || !LABELS[payload.act]) return page("Link expired", "This link is invalid or older than 14 days. Use the dashboard instead.", false);
  const [d] = await db().select().from(deliveries).where(eq(deliveries.id, payload.did));
  const [r] = d ? await db().select().from(reminders).where(eq(reminders.id, d.reminderId)) : [];
  if (!r) return page("Not found", "This reminder no longer exists.", false);
  const form = `<form method="post" action="/api/action?t=${encodeURIComponent(token!)}">
<button style="background:#6366f1;color:#fff;border:0;border-radius:12px;padding:14px 22px;font-size:16px;font-weight:600;cursor:pointer;margin-bottom:20px">${esc(LABELS[payload.act])}</button></form>`;
  return page(r.title, r.allDay ? fmtLocal(d.occurrenceAt, "EEEE, d MMM") : fmtLocal(d.occurrenceAt, "EEEE, d MMM · h:mm a"), true, form);
}

export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("t");
  const payload = await verifyToken<{ did: string; act: string }>(token);
  if (!payload) return page("Link expired", "This link is invalid or older than 14 days. Use the dashboard instead.", false);

  const [d] = await db().select().from(deliveries).where(eq(deliveries.id, payload.did));
  if (!d) return page("Not found", "This reminder no longer exists.", false);
  const [r] = await db().select().from(reminders).where(eq(reminders.id, d.reminderId));
  if (!r) return page("Not found", "This reminder was deleted.", false);

  if (payload.act === "done") {
    await completeOccurrence(r.id, d.occurrenceAt);
    const msg = `"${r.title}" is done. No more alerts for it${r.rrule ? " this time" : ""}.`;
    if (!r.amountPaise) return page("Marked as done", msg);
    // Bill reminder: offer to log the payment as an expense.
    const logToken = await signToken({ did: d.id, act: "log" }, "14d");
    const form = `<form method="post" action="/api/action?t=${encodeURIComponent(logToken)}">
<button style="background:#10b981;color:#fff;border:0;border-radius:12px;padding:14px 22px;font-size:16px;font-weight:600;cursor:pointer;margin-bottom:20px">Log ${esc(formatINR(r.amountPaise))} as paid</button></form>`;
    return page("Marked as done", msg, true, form);
  }

  if (payload.act === "log") {
    const res = await logReminderPayment(r.id, d.occurrenceAt);
    if ("error" in res && res.error) return page("Couldn't log", res.error, false);
    if (!("transaction" in res) || !res.transaction) return page("Couldn't log", "Something went wrong.", false);
    return page(res.already ? "Already logged" : "Payment logged", `${formatINR(res.transaction.amountPaise)} for "${r.title}" is in your expenses.`);
  }

  let minutes = 0;
  if (payload.act === "snooze15") minutes = 15;
  else if (payload.act === "snooze60") minutes = 60;
  else if (payload.act === "tomorrow") {
    const tomorrow = fmtLocal(new Date(Date.now() + 86400000), "yyyy-MM-dd");
    const target = localToUtc(tomorrow, config.allDayHour);
    minutes = Math.max(1, Math.round((target.getTime() - Date.now()) / 60000));
  } else return page("Unknown action", "That link isn't recognised.", false);

  const until = await snoozeOccurrence(r.id, d.occurrenceAt, minutes);
  return page("Snoozed", `"${r.title}" will remind you again at ${until ? fmtLocal(until, "h:mm a, EEE d MMM") : "later"}.`);
}
