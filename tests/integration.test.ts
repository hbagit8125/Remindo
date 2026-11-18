/**
 * End-to-end check of scheduling, sending, done/snooze and escalation against an
 * in-memory Postgres (PGlite). Emails are intercepted instead of sent.
 * Run: npm test
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

process.env.RESEND_API_KEY = "re_test";
process.env.NOTIFY_EMAIL = "me@example.com";
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
process.env.APP_URL = "https://example.test";
delete process.env.QSTASH_TOKEN;
delete process.env.GEMINI_API_KEY;
delete process.env.GROQ_API_KEY;

const sent: { subject: string; html: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (String(url).includes("api.resend.com")) {
    const b = JSON.parse(String(init?.body));
    sent.push({ subject: b.subject, html: b.html });
    return new Response(JSON.stringify({ id: `email_${sent.length}` }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(url as string, init);
}) as typeof fetch;

async function main() {
  const pg = new PGlite();
  for (const stmt of readFileSync("drizzle/0000_init.sql", "utf8").split("--> statement-breakpoint")) await pg.exec(stmt);
  const schema = await import("../src/db/schema");
  (globalThis as Record<string, unknown>).__testDb = drizzle(pg, { schema });

  const { db, reminders, deliveries, completions } = await import("../src/db");
  const { inputToRow } = await import("../src/lib/reminder-input");
  const S = await import("../src/lib/scheduler");
  const { sendDailyDigest } = await import("../src/lib/digest");
  const { eq } = await import("drizzle-orm");

  const now = new Date();
  const local = (offsetMin: number) => {
    const d = new Date(now.getTime() + offsetMin * 60000);
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
    const g = (t: string) => f.find((p) => p.type === t)!.value;
    return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
  };

  // 1. A high-priority reminder due 1 minute ago with lead times -> the on-time alert is sent by planning.
  const due = local(-1);
  const [r1] = await db().insert(reminders).values(inputToRow({ title: "Pay electricity bill", ...due, recurrence: "none", interval: 1, priority: "high" })).returning();
  const plan = await S.planAndQueue({ reminderIds: [r1.id] });
  console.log("plan r1", plan);
  assert.equal(sent.length, 1, "on-time alert sent immediately");
  assert.match(sent[0].subject, /Pay electricity bill/);
  assert.match(sent[0].html, /api\/action\?t=/);

  // Escalation was queued for high priority.
  const esc = await db().select().from(deliveries).where(eq(deliveries.kind, "escalation"));
  assert.equal(esc.length, 1, "escalation queued");

  // Re-planning is idempotent.
  await S.planAndQueue({ reminderIds: [r1.id] });
  assert.equal(sent.length, 1, "no duplicate send");

  // 2. Mark done -> escalation cancelled, one-off becomes done.
  const [d1] = await db().select().from(deliveries).where(eq(deliveries.reminderId, r1.id));
  await S.completeOccurrence(r1.id, d1.occurrenceAt);
  const [after] = await db().select().from(reminders).where(eq(reminders.id, r1.id));
  assert.equal(after.status, "done");
  const [escAfter] = await db().select().from(deliveries).where(eq(deliveries.kind, "escalation"));
  assert.equal(escAfter.status, "cancelled");
  assert.equal(await S.sendDelivery(escAfter.id), "skipped");

  // 3. Daily recurring reminder in 30 min: queued, not sent; sweep doesn't send early.
  const later = local(30);
  const [r2] = await db().insert(reminders).values(inputToRow({ title: "Stand-up", ...later, recurrence: "daily", interval: 1, priority: "normal" })).returning();
  await S.planAndQueue({ reminderIds: [r2.id] });
  const r2d = await db().select().from(deliveries).where(eq(deliveries.reminderId, r2.id));
  assert.ok(r2d.length >= 2, "today and tomorrow occurrences planned in 48h window");
  assert.ok(r2d.every((d) => d.status === "queued"));
  await S.sweep();
  assert.equal(sent.length, 1, "sweep doesn't send future alerts");

  // Simulate time passing: sweep 35 min later sends the missed one (QStash absent/failed).
  const res = await S.sweep(new Date(now.getTime() + 35 * 60000));
  console.log("sweep later", res);
  assert.equal(sent.length, 2, "sweep catches overdue alert");
  assert.match(sent[1].subject, /Stand-up/);

  // 4. Snooze creates a new alert; done for one occurrence keeps the series active.
  const first = r2d.sort((a, b) => +a.occurrenceAt - +b.occurrenceAt)[0];
  const until = await S.snoozeOccurrence(r2.id, first.occurrenceAt, 15);
  assert.ok(until);
  await S.completeOccurrence(r2.id, first.occurrenceAt);
  const [r2after] = await db().select().from(reminders).where(eq(reminders.id, r2.id));
  assert.equal(r2after.status, "active", "recurring stays active");
  const snoozeRow = (await db().select().from(deliveries).where(eq(deliveries.kind, "snooze")))[0];
  assert.equal(snoozeRow.status, "cancelled", "done cancels pending snooze");
  assert.equal((await db().select().from(completions)).length, 2);

  // 5. Birthday with week/day lead times.
  const bday = local(3 * 24 * 60);
  const [r3] = await db().insert(reminders).values(inputToRow({ title: "Ammu's birthday", date: bday.date, time: null, recurrence: "yearly", interval: 1, priority: "high" })).returning();
  assert.deepEqual(r3.leadTimes, [10080, 1440, 0]);

  // 6. Agenda + digest.
  const ag = await S.agenda(new Date(now.getTime() - 86400000), new Date(now.getTime() + 10 * 86400000));
  assert.ok(ag.find((a) => a.title === "Ammu's birthday"));
  const dg = await sendDailyDigest(now);
  console.log("digest", dg, sent.at(-1)?.subject);
  assert.match(sent.at(-1)!.subject, /Today/);

  // 7. Action tokens round-trip.
  const { verifyToken } = await import("../src/lib/auth");
  const token = decodeURIComponent(sent[1].html.match(/t=([^"&]+)/)![1]);
  const p = await verifyToken<{ did: string; act: string }>(token);
  assert.equal(p?.act, "done");

  console.log(`\n✓ all checks passed (${sent.length} emails captured)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
