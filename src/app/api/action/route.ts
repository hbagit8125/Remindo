import { eq } from "drizzle-orm";
import { db, deliveries, reminders } from "@/db";
import { signToken, verifyToken } from "@/lib/auth";
import { formatINR } from "@/lib/money";
import { ACTIONS, performAction, type ActionName } from "@/lib/actions";
import { esc } from "@/lib/email";
import { config } from "@/lib/config";
import { fmtLocal } from "@/lib/time";

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
  if (!(ACTIONS as readonly string[]).includes(payload.act)) return page("Unknown action", "That link isn't recognised.", false);

  const res = await performAction(payload.did, payload.act as ActionName, "email");
  if (res.canLog) {
    // Bill reminder: offer to log the payment as an expense.
    const logToken = await signToken({ did: payload.did, act: "log" }, "14d");
    const form = `<form method="post" action="/api/action?t=${encodeURIComponent(logToken)}">
<button style="background:#10b981;color:#fff;border:0;border-radius:12px;padding:14px 22px;font-size:16px;font-weight:600;cursor:pointer;margin-bottom:20px">Log ${esc(formatINR(res.canLog))} as paid</button></form>`;
    return page(res.title, res.message, true, form);
  }
  return page(res.title, res.message, res.ok);
}
