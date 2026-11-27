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

const sent: { subject: string; html: string; attachments?: { filename: string; content: unknown }[] }[] = [];
const tgCalls: { method: string; body: Record<string, unknown> }[] = [];
const aiCalls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (String(url).includes("api.resend.com")) {
    const b = JSON.parse(String(init?.body));
    sent.push({ subject: b.subject, html: b.html, attachments: b.attachments });
    return new Response(JSON.stringify({ id: `email_${sent.length}` }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (String(url).includes("generativelanguage.googleapis.com")) {
    aiCalls.push("gemini:" + String(url).split("/models/")[1].split(":")[0]);
    return new Response(JSON.stringify({ error: { code: 503, message: "overloaded" } }), { status: 503 });
  }
  if (String(url).includes("api.anthropic.com")) {
    aiCalls.push("claude:" + JSON.parse(String(init?.body)).model);
    const text = '"reminders":[{"title":"Call mom","date":"2026-11-20","time":"19:00","recurrence":"none","interval":1,"priority":"normal"}],"transactions":[{"type":"expense","amount":50,"category":"Food","note":"Tea","date":"2026-11-19"}]}';
    return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  const tgMatch = String(url).match(/api\.telegram\.org\/bot[^/]+\/(\w+)/);
  if (tgMatch) {
    tgCalls.push({ method: tgMatch[1], body: JSON.parse(String(init?.body || "{}")) });
    const result = tgMatch[1] === "getMe" ? { id: 1, username: "test_bot", first_name: "Remindo" } : { message_id: tgCalls.length, chat: { id: 42 } };
    return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(url as string, init);
}) as typeof fetch;

async function main() {
  const pg = new PGlite();
  for (const file of ["drizzle/0000_init.sql", "drizzle/0001_expenses.sql", "drizzle/0002_notifications.sql", "drizzle/0003_tasks.sql", "drizzle/0004_money_plus.sql", "drizzle/0005_life.sql", "drizzle/0006_sync.sql", "drizzle/0007_splits.sql", "drizzle/0008_undo.sql", "drizzle/0009_credit_cards.sql", "drizzle/0010_savings.sql"])
    for (const stmt of readFileSync(file, "utf8").split("--> statement-breakpoint")) await pg.exec(stmt);
  const schema = await import("../src/db/schema");
  (globalThis as Record<string, unknown>).__testDb = drizzle(pg, { schema });

  const { db, reminders, deliveries, completions } = await import("../src/db");
  const { inputToRow } = await import("../src/lib/reminder-input");
  const S = await import("../src/lib/scheduler");
  const { sendDailyDigest } = await import("../src/lib/digest");
  const { and, eq } = await import("drizzle-orm");

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

  // 8. Expenses: budgets, alerts, bill → expense, digest spending.
  const F = await import("../src/lib/finance");
  const { transactions, budgetAlerts } = await import("../src/db");
  const { TOTAL_BUDGET } = await import("../src/lib/money");
  const todayStr = local(0).date;
  const month = todayStr.slice(0, 7);
  await F.setBudgets({ [TOTAL_BUDGET]: 1000, Food: 300 });
  await db().insert(transactions).values([
    F.inputToTxRow({ type: "expense", amount: 250, category: "Food", date: todayStr }),
    F.inputToTxRow({ type: "income", amount: 50000, category: "Salary", date: todayStr }),
  ]);
  const before = sent.length;
  await F.checkBudgetAlerts([month]);
  assert.equal(sent.length, before + 1, "Food 83% -> one 80% alert");
  assert.match(sent.at(-1)!.subject, /Food budget/);
  await F.checkBudgetAlerts([month]);
  assert.equal(sent.length, before + 1, "alert not repeated");
  await db().insert(transactions).values(F.inputToTxRow({ type: "expense", amount: 800, category: "Rent", date: todayStr }));
  await F.checkBudgetAlerts([month]);
  const alerts = await db().select().from(budgetAlerts);
  assert.ok(alerts.find((a) => a.category === TOTAL_BUDGET && a.threshold === 100), "total over budget alert");

  const ins = await F.insights(month);
  assert.equal(ins.spent, 105000);
  assert.equal(ins.income, 5000000);
  assert.equal(ins.byCategory[0].category, "Rent");

  // Bill reminder with amount -> log payment once.
  const [bill] = await db().insert(reminders).values(inputToRow({ title: "Pay rent", ...local(60), recurrence: "monthly", interval: 1, priority: "high", amount: 15000 })).returning();
  assert.equal(bill.amountPaise, 1500000);
  const occ = bill.dueAt;
  const l1 = await F.logReminderPayment(bill.id, occ);
  const l2 = await F.logReminderPayment(bill.id, occ);
  assert.ok("transaction" in l1 && !l1.already && l1.transaction?.category === "Rent");
  assert.ok("already" in l2 && l2.already, "no double logging");
  const ag2 = await S.agenda(new Date(occ.getTime() - 1000), new Date(occ.getTime() + 1000));
  assert.ok(ag2.find((x) => x.reminderId === bill.id)?.paid, "agenda shows paid");

  await sendDailyDigest(new Date());
  assert.match(sent.at(-1)!.html, /This month/);
  assert.match(F.toCsv(await F.listAllTransactions()), /Date,Type,Amount/);

  // Parser: money vs reminders offline.
  const { parseLocally } = await import("../src/lib/parse");
  assert.equal(parseLocally("Spent 450 on lunch").transactions[0].category, "Food");
  assert.equal(parseLocally("Call mom tomorrow at 7pm").reminders.length, 1);

  // 9. Phase 1: channels, quiet hours, Telegram, evening review, error alerts.
  const Set_ = await import("../src/lib/settings");
  const { vapidKeys } = await import("../src/lib/push");
  const keys = await vapidKeys();
  assert.ok(keys.publicKey.length > 40, "VAPID keys auto-generated");
  assert.deepEqual(await vapidKeys(), keys, "VAPID keys stable");

  const q = { enabled: true, start: "23:00", end: "07:00" };
  const at = (hhmm: string) => new Date(`2026-11-19T${hhmm}:00+05:30`);
  assert.equal(Set_.inQuietHours(q, at("23:30")), true);
  assert.equal(Set_.inQuietHours(q, at("06:59")), true);
  assert.equal(Set_.inQuietHours(q, at("07:00")), false);
  assert.equal(Set_.inQuietHours(q, at("14:00")), false);
  assert.equal(Set_.inQuietHours({ ...q, enabled: false }, at("23:30")), false);

  await Set_.setSetting("telegram", { token: "123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", chatId: 42, chatName: "Hashir" });
  // Quiet window that always includes "now": normal reminders skip Telegram, high ones don't.
  const nowHM = local(0).time;
  const endHM = local(120).time;
  await Set_.setSetting("prefs", { ...Set_.DEFAULT_PREFS, quietHours: { enabled: true, start: local(-60).time, end: endHM } });
  void nowHM;
  const [quietR] = await db().insert(reminders).values(inputToRow({ title: "Water plants", ...local(-1), recurrence: "none", interval: 1, priority: "normal" })).returning();
  const tgBefore = tgCalls.length;
  const emailsBefore = sent.length;
  await S.planAndQueue({ reminderIds: [quietR.id] });
  assert.equal(sent.length, emailsBefore + 1, "email still sent in quiet hours");
  assert.equal(tgCalls.length, tgBefore, "telegram held in quiet hours");
  const [heldRow] = await db().select().from(deliveries).where(eq(deliveries.reminderId, quietR.id));
  assert.equal(heldRow.held, true);

  const [loudR] = await db().insert(reminders).values(inputToRow({ title: "Pay credit card", ...local(-1), recurrence: "none", interval: 1, priority: "high", amount: 5000 })).returning();
  await S.planAndQueue({ reminderIds: [loudR.id] });
  const msg = tgCalls.filter((c) => c.method === "sendMessage").at(-1)!;
  assert.match(String(msg.body.text), /Pay credit card/);
  const kb = (msg.body.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard.flat();
  assert.ok(kb.find((b) => b.callback_data.startsWith("a:log:")), "bill shows Log button");
  assert.ok(kb.every((b) => Buffer.byteLength(b.callback_data) <= 64), "callback_data within Telegram limit");

  // Tap "Done" in Telegram via the real webhook route.
  const { webhookSecret } = await import("../src/lib/telegram");
  const hook = await import("../src/app/api/telegram/webhook/route");
  const doneBtn = kb.find((b) => b.callback_data.startsWith("a:done:"))!;
  const call = (update: object, secret = webhookSecret()) =>
    hook.POST(new Request("https://x/api/telegram/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify(update) }));
  assert.equal((await call({}, "wrong")).status, 403, "webhook rejects bad secret");
  await call({ callback_query: { id: "cb1", data: doneBtn.callback_data, from: { id: 42 }, message: { message_id: 7, chat: { id: 42 }, text: "❗ Pay credit card" } } });
  const [loudAfter] = await db().select().from(reminders).where(eq(reminders.id, loudR.id));
  assert.equal(loudAfter.status, "done", "Telegram Done marks reminder done");
  const edit = tgCalls.filter((c) => c.method === "editMessageText").at(-1)!;
  assert.match(JSON.stringify(edit.body), /a:log:/, "offers Log after Done");

  // A stranger's chat is ignored; the owner's text becomes a draft with Save/Cancel.
  const before2 = tgCalls.length;
  await call({ message: { message_id: 1, chat: { id: 999 }, text: "Spent 100 on tea" } });
  assert.equal(tgCalls.length, before2, "other chats ignored");
  await call({ message: { message_id: 2, chat: { id: 42 }, text: "Spent 100 on tea" } });
  const draftMsg = tgCalls.filter((c) => c.method === "sendMessage").at(-1)!;
  assert.match(String(draftMsg.body.text), /₹100/);
  const saveBtn = (draftMsg.body.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0][0];
  const txBefore = (await F.listAllTransactions()).length;
  await call({ callback_query: { id: "cb2", data: saveBtn.callback_data, from: { id: 42 }, message: { message_id: 8, chat: { id: 42 }, text: "draft" } } });
  assert.equal((await F.listAllTransactions()).length, txBefore + 1, "Save creates the expense");
  await call({ callback_query: { id: "cb3", data: saveBtn.callback_data, from: { id: 42 }, message: { message_id: 8, chat: { id: 42 }, text: "draft" } } });
  assert.equal((await F.listAllTransactions()).length, txBefore + 1, "double tap doesn't duplicate");

  // Linking flow.
  await Set_.setSetting("telegram", { token: "123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", linkCode: "abc123", linkExpires: Date.now() + 60000 });
  await call({ message: { message_id: 3, chat: { id: 77, first_name: "Hashir" }, text: "/start wrong" } });
  assert.equal((await Set_.getTelegram()).chatId, undefined, "wrong code doesn't link");
  await call({ message: { message_id: 4, chat: { id: 77, first_name: "Hashir" }, text: "/start abc123" } });
  assert.equal((await Set_.getTelegram()).chatId, 77, "correct code links chat");

  // Evening review + morning "while you slept".
  const { sendEveningReview } = await import("../src/lib/digest");
  const ev = await sendEveningReview(new Date());
  assert.match(sent.at(-1)!.subject, /🌙/);
  console.log("evening", ev);
  await Set_.setSetting("prefs", Set_.DEFAULT_PREFS);
  await sendDailyDigest(new Date());
  assert.match(sent.at(-1)!.html, /While you slept/);

  // Error alerts: at most one per job per hour.
  const { reportError } = await import("../src/lib/errors");
  const e1 = sent.length;
  await reportError("test job", "boom");
  await reportError("test job", "boom again");
  assert.equal(sent.length, e1 + 1, "error alert rate-limited");

  // 10. AI fallback chain: Gemini busy → backup Gemini busy → Claude.
  const { parsePrompt } = await import("../src/lib/parse");
  process.env.GEMINI_API_KEY = "test";
  process.env.ANTHROPIC_API_KEY = "test";
  const viaClaude = await parsePrompt("Call mom tomorrow 7pm and spent 50 on tea");
  assert.equal(viaClaude.engine, "claude");
  assert.deepEqual(aiCalls, ["gemini:gemini-flash-lite-latest", "gemini:gemini-flash-latest", "claude:claude-haiku-5-5"]);
  assert.equal(viaClaude.reminders.length + viaClaude.transactions.length, 2);
  delete process.env.ANTHROPIC_API_KEY;
  const offline = await parsePrompt("Call mom tomorrow at 7pm and spent 50 on tea");
  assert.equal(offline.engine, "local");
  assert.equal(offline.reminders.length, 1, "offline splits the reminder");
  assert.equal(offline.transactions.length, 1, "offline splits the expense");
  assert.doesNotMatch(offline.warning || "", /\{|503/, "friendly warning, no raw error");
  delete process.env.GEMINI_API_KEY;

  // 11. Phase 2: tasks, focus carry-over, calendar, search.
  const T = await import("../src/lib/tasks");
  const day1 = new Date("2026-11-19T06:00:00Z"); // 11:30 IST
  const day2 = new Date("2026-11-20T06:00:00Z");
  const [milk, report, someday] = await T.createTasks(
    [
      { title: "Buy milk", focus: true, priority: "normal" },
      { title: "Finish report", dueDate: "2026-11-20", focus: false, priority: "high" },
      { title: "Learn guitar", focus: false, priority: "low" },
    ],
    day1,
  );
  let focus = T.focusFrom(await T.listTasks(day1), day1);
  assert.deepEqual(focus.map((t) => t.title), ["Buy milk"], "only starred task in today's focus");
  focus = T.focusFrom(await T.listTasks(day2), day2);
  assert.deepEqual(focus.map((t) => t.title).sort(), ["Buy milk", "Finish report"], "unfinished star carries over; due-today joins");
  assert.equal(focus.find((t) => t.title === "Buy milk")!.carried, true);
  await T.updateTask(milk.id, { done: true }, day2);
  focus = T.focusFrom(await T.listTasks(new Date()), new Date());
  assert.ok(!focus.find((t) => t.id === someday.id), "someday task not in focus");
  const sum = await T.taskDaySummary(new Date());
  assert.ok(sum.doneToday.find((t) => t.id === milk.id), "done-today summary");
  void report;

  const cal = await import("../src/app/api/calendar/route");
  const calRes = await (await cal.GET(new Request("https://x/api/calendar?from=2026-11-16&to=2026-11-22"))).json();
  assert.ok(calRes.days["2026-11-20"].tasks.find((t: { title: string }) => t.title === "Finish report"), "calendar shows task due");
  const todayKey = local(0).date;
  if (todayKey >= "2026-11-16" && todayKey <= "2026-11-22") assert.ok(calRes.days[todayKey]?.spent > 0, "calendar shows spend");
  assert.equal((await cal.GET(new Request("https://x/api/calendar?from=2026-01-01&to=2026-12-31"))).status, 400, "range capped");

  const search = await import("../src/app/api/search/route");
  const sr = await (await search.GET(new Request("https://x/api/search?q=report"))).json();
  assert.equal(sr.tasks[0].title, "Finish report");
  const byAmount = await (await search.GET(new Request("https://x/api/search?q=100"))).json();
  assert.ok(byAmount.transactions.length >= 1, "search by amount");

  // Telegram draft containing a task.
  await Set_.setSetting("telegram", { token: "123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", chatId: 42 });
  await call({ message: { message_id: 9, chat: { id: 42 }, text: "todo: renew passport" } });
  const tdraft = tgCalls.filter((c) => c.method === "sendMessage").at(-1)!;
  assert.match(String(tdraft.body.text), /☑️ <b>Renew passport/);
  const tsave = (tdraft.body.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0][0];
  await call({ callback_query: { id: "cb9", data: tsave.callback_data, from: { id: 42 }, message: { message_id: 10, chat: { id: 42 }, text: "d" } } });
  assert.ok((await T.listTasks()).find((t) => t.title === "Renew passport"), "Telegram saves the task");
  await call({ message: { message_id: 11, chat: { id: 42 }, text: "/today" } });
  assert.match(String(tgCalls.filter((c) => c.method === "sendMessage").at(-1)!.body.text), /Focus|Today/);

  const ev2 = await sendEveningReview(new Date());
  void ev2;
  assert.match(sent.at(-1)!.html, /Tasks finished/);

  // 12. Phase 3: accounts, transfers, favourites, dues, goals, year, monthly report, SMS.
  const MP = await import("../src/lib/moneyplus");
  const { accounts } = await import("../src/db");
  const { createTransactions, createReminders } = await import("../src/lib/create");
  const [sbi] = await db().insert(accounts).values({ name: "SBI", kind: "bank", openingBalancePaise: 1000000 }).returning();
  const [cash] = await db().insert(accounts).values({ name: "Cash", kind: "cash", openingBalancePaise: 50000 }).returning();
  await createTransactions([
    { type: "expense", amount: 300, category: "Food", date: todayKey, accountId: sbi.id },
    { type: "income", amount: 2000, category: "Salary", date: todayKey, accountId: sbi.id },
    { type: "transfer", amount: 1000, category: "Transfer", date: todayKey, accountId: sbi.id, toAccountId: cash.id },
  ]);
  const accs = await MP.listAccounts();
  assert.equal(accs.find((a) => a.id === sbi.id)!.balancePaise, 1000000 - 30000 + 200000 - 100000, "SBI balance");
  assert.equal(accs.find((a) => a.id === cash.id)!.balancePaise, 50000 + 100000, "cash balance gets transfer");
  const insAfter = await F.insights(todayKey.slice(0, 7));
  assert.ok(!insAfter.byCategory.find((c) => c.category === "Transfer"), "transfers aren't spending");

  const { favourites } = await import("../src/db");
  const [fav] = await db().insert(favourites).values({ label: "Chai ₹20", payload: { type: "expense", amount: 20, category: "Food", note: "Chai", method: "cash" } }).returning();
  const favTx = await MP.logFavourite(fav.id);
  assert.equal(favTx!.amountPaise, 2000);
  for (let i = 0; i < 3; i++) await createTransactions([{ type: "expense", amount: 40, category: "Transport", note: "Metro", date: todayKey }]);
  const sug = await MP.suggestFavourites();
  assert.ok(sug.find((x) => x.label.startsWith("Metro")), "frequent entry suggested as favourite");

  const [arunDue] = await MP.createDues([{ person: "Arun", direction: "they_owe", amount: 600, note: "dinner" }]);
  assert.ok(arunDue.reminderId, "collect reminder created");
  const dl = await MP.listDues();
  assert.equal(dl.theyOwe, 60000);
  const txCount = (await F.listAllTransactions()).length;
  await MP.settleDue(arunDue.id, { log: true });
  assert.equal((await F.listAllTransactions()).length, txCount + 1, "settling logs income");
  assert.equal((await MP.listDues()).theyOwe, 0);
  assert.equal(await MP.settleDue(arunDue.id, { log: true }), null, "can't settle twice");

  const { goals } = await import("../src/db");
  const [goal] = await db().insert(goals).values({ name: "Goa", targetPaise: 5000000, deadline: `${Number(todayKey.slice(0, 4)) + 1}-03-01` }).returning();
  await MP.addContribution(goal.id, 5000, null);
  const g = (await MP.listGoals()).find((x) => x.id === goal.id)!;
  assert.equal(g.savedPaise, 500000);
  assert.ok(g.perMonthPaise && g.perMonthPaise > 0, "per-month amount");

  const yr = await MP.yearInsights(Number(todayKey.slice(0, 4)));
  assert.equal(yr.months.length, 12);
  assert.ok(yr.spent > 0);

  const { sendMonthlyReport } = await import("../src/lib/digest");
  await sendMonthlyReport(new Date(new Date().getTime() + 31 * 86400000));
  assert.match(sent.at(-1)!.subject, /📊/);

  const P3 = await import("../src/lib/parse");
  const sms = P3.parseLocally("Rs.450.00 debited from A/c XX1234 on 19-11-26 to VPA swiggy@icici UPI Ref 123456. Avl Bal Rs 12,000");
  assert.equal(sms.transactions[0].amount, 450);
  assert.equal(sms.transactions[0].merchant, "Swiggy");
  // A shared bill is one split (the split records the expense), not an expense + a due.
  const split = P3.parseLocally("Paid 1200 for dinner, Arun owes me 600");
  assert.equal(split.transactions.length, 0);
  assert.equal(split.dues!.length, 0);
  assert.deepEqual(split.splits![0].people, [{ person: "me", value: 600 }, { person: "Arun", value: 600 }]);
  const eq3 = P3.parseLocally("Paid 1200 for dinner with Arun and Riya, split equally").splits![0];
  assert.equal(eq3.method, "equal");
  assert.equal(eq3.people.length, 3);
  const friendPaid = P3.parseLocally("Sneha paid 900 for movie, split with me and Manu").splits![0];
  assert.equal(friendPaid.paidBy, "Sneha");
  assert.equal(P3.parseLocally("split the cab 600 with Arun").splits![0].amount, 600);
  assert.equal(P3.parseLocally("Arun owes me 600").dues![0].person, "Arun");

  // Telegram photo when Gemini is down → friendly error, no crash.
  process.env.GEMINI_API_KEY = "test";
  await Set_.setSetting("telegram", { token: "123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", chatId: 42 });
  const realFetch2 = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("/file/bot")) return new Response(new Uint8Array([1, 2, 3]));
    if (String(url).includes("getFile")) return new Response(JSON.stringify({ ok: true, result: { file_path: "p.jpg", file_size: 3 } }));
    return realFetch2(url as string, init);
  }) as typeof fetch;
  await call({ message: { message_id: 20, chat: { id: 42 }, photo: [{ file_id: "f1", width: 10, height: 10 }] } });
  globalThis.fetch = realFetch2;
  delete process.env.GEMINI_API_KEY;
  assert.match(String(tgCalls.filter((c) => c.method === "sendMessage").at(-1)!.body.text), /Something went wrong|couldn/i);

  // 13. Phase 4: questions, commands, suggestions.
  const AS = await import("../src/lib/assistant");
  const spendAns = await AS.answerQuestion({ kind: "spend", category: "Food" });
  assert.match(spendAns.text, /You spent ₹/);
  const agendaAns = await AS.answerQuestion({ kind: "agenda" });
  assert.ok(agendaAns.text.length > 0);
  await createReminders([{ title: "Dentist appointment", date: local(60 * 24 * 2).date, time: "10:00", recurrence: "none", interval: 1, priority: "normal" }]);
  const { createReminders: _cr } = await import("../src/lib/create");
  void _cr;
  const findAns = await AS.answerQuestion({ kind: "find", keyword: "dentist" });
  assert.match(findAns.text, /Dentist appointment: .*in 2 days|tomorrow|in 1 days/);
  const cands = await AS.resolveCommand({ action: "reschedule", target: "dentist", date: local(60 * 24 * 5).date, time: "17:00" });
  assert.equal(cands[0].title, "Dentist appointment");
  const moveMsg = await AS.executeCommand({ action: "reschedule", kind: "reminder", id: cands[0].id, date: local(60 * 24 * 5).date, time: "17:00" });
  assert.match(moveMsg, /Moved to/);
  const moved = (await AS.answerQuestion({ kind: "find", keyword: "dentist" })).text;
  assert.match(moved, /5:00 pm|in 5 days|in 4 days/);
  const tcands = await AS.resolveCommand({ action: "complete", target: "guitar" });
  assert.equal(tcands[0].kind, "task");
  await AS.executeCommand({ action: "complete", kind: "task", id: tcands[0].id });
  assert.equal((await AS.resolveCommand({ action: "complete", target: "guitar" })).length, 0, "done task no longer matches");
  const dcands = await AS.resolveCommand({ action: "delete", target: "dentist" });
  await AS.executeCommand({ action: "delete", kind: "reminder", id: dcands[0].id });
  assert.equal((await AS.answerQuestion({ kind: "find", keyword: "dentist" })).text.startsWith("I couldn't"), true);

  // Parse route returns answers/proposals (offline engine).
  const parseRoute = await import("../src/app/api/parse/route");
  const pr = await (await parseRoute.POST(new Request("https://x/api/parse", { method: "POST", body: JSON.stringify({ text: "who owes me money" }) }))).json();
  assert.ok(pr.answer?.text, "answer returned");

  // Suggestions: same bill in 2 months → monthly reminder suggestion.
  const SG = await import("../src/lib/suggestions");
  const m0 = local(0).date;
  const prevMonth = F.shiftMonth(m0.slice(0, 7), -1);
  const prev2 = F.shiftMonth(m0.slice(0, 7), -2);
  await createTransactions([
    { type: "expense", amount: 1450, category: "Bills", note: "KSEB electricity", date: `${prevMonth}-10` },
    { type: "expense", amount: 1300, category: "Bills", note: "KSEB electricity", date: `${prev2}-11` },
  ]);
  const sugg = await SG.getSuggestions();
  const billSug = sugg.find((x) => x.kind === "recurring_bill");
  assert.ok(billSug, "recurring bill spotted");
  await SG.acceptSuggestion(billSug!.key);
  assert.ok(!(await SG.getSuggestions()).find((x) => x.key === billSug!.key), "accepted suggestion disappears");
  const rem = (await AS.answerQuestion({ kind: "find", keyword: "KSEB" })).text;
  assert.match(rem, /Pay KSEB electricity/);

  // Telegram question → answered.
  await call({ message: { message_id: 30, chat: { id: 42 }, text: "who owes me money" } });
  assert.match(String(tgCalls.filter((c) => c.method === "sendMessage").at(-1)!.body.text), /💬/);
  await call({ message: { message_id: 31, chat: { id: 42 }, text: "Delete the KSEB reminder" } });
  const conf = tgCalls.filter((c) => c.method === "sendMessage").at(-1)!;
  assert.match(String(conf.body.text), /Confirm/);
  const doBtn = (conf.body.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0][0];
  await call({ callback_query: { id: "cbx", data: doBtn.callback_data, from: { id: 42 }, message: { message_id: 32, chat: { id: 42 }, text: "Confirm" } } });
  assert.ok((await AS.answerQuestion({ kind: "find", keyword: "KSEB" })).text.startsWith("I couldn't"), "Telegram-confirmed delete ran");

  // ---------------------------------------------------------------- Phase 5: life
  const L = await import("../src/lib/life");
  const expiry = F.shiftMonth(local(0).date.slice(0, 7), 2) + "-15";
  const doc = await L.saveDocument({ kind: "vehicle_insurance", name: "TEST Activa insurance", expiryDate: expiry, renewalCost: 1800 });
  const [docR] = await db().select().from(reminders).where(eq(reminders.id, doc!.reminderId!));
  assert.equal(docR.title, "Renew TEST Activa insurance");
  assert.deepEqual(docR.leadTimes, [43200, 10080, 1440, 0]);
  const renewed = await L.renewDocument(doc!.id, expiry.replace(/^\d{4}/, (y) => String(Number(y) + 1)), 1750);
  assert.equal(renewed!.reminderId, doc!.reminderId, "same reminder reused on renew");
  const [docR2] = await db().select().from(reminders).where(eq(reminders.id, doc!.reminderId!));
  assert.ok(docR2.dueAt > docR.dueAt, "renewal moved the reminder");

  // People: birthday → yearly reminder, nextDate handles Feb 29.
  assert.match(L.nextDate("02-29", new Date("2027-03-01T00:00:00Z")), /^2028-02-29$/);
  assert.equal(L.nextDate("02-29", new Date("2026-12-01T00:00:00Z")), "2027-02-28");
  const person = await L.savePerson({ name: "TEST Ammu", birthday: "01-05", birthYear: 1998, giftIdeas: "Books" });
  const [bR] = await db().select().from(reminders).where(eq(reminders.id, person!.birthdayReminderId!));
  assert.equal(bR.rrule?.startsWith("FREQ=YEARLY"), true);
  assert.match(bR.notes || "", /Books/);
  const ppl = await L.listPeople();
  assert.ok(ppl[0].daysToBirthday !== null && ppl[0].turning! > 20);
  await L.savePerson({ name: "TEST Ammu", birthday: null }, person!.id);
  assert.equal((await db().select().from(reminders).where(eq(reminders.id, person!.birthdayReminderId!))).length, 0, "birthday reminder removed");

  // Medicines: completing a dose lowers stock; one refill alert at threshold.
  const med = await L.saveMedicine({ name: "TEST Vit D", dose: "1 tab", times: ["21:00", "09:00"], stock: 4, perDose: 1, refillAt: 3 });
  assert.deepEqual(med!.times, ["09:00", "21:00"]);
  assert.equal(med!.reminderIds.length, 2);
  const emailsMed = sent.length;
  await S.completeOccurrence(med!.reminderIds[0], new Date());
  const { medicines } = await import("../src/db");
  let [m1] = await db().select().from(medicines).where(eq(medicines.id, med!.id));
  assert.equal(m1.stock, 3);
  assert.ok(m1.refillAlertSentAt, "refill alert flagged");
  assert.equal(sent.length, emailsMed + 1, "refill email sent once");
  await S.completeOccurrence(med!.reminderIds[1], new Date());
  assert.equal(sent.length, emailsMed + 1, "no second refill email");
  await L.refillMedicine(med!.id, 30);
  [m1] = await db().select().from(medicines).where(eq(medicines.id, med!.id));
  assert.equal(m1.stock, 32);
  assert.equal(m1.refillAlertSentAt, null);
  await L.deleteMedicine(med!.id);

  // Lists: offline parser + addToList creates the list once.
  const pl = parseLocally("add eggs, bread and milk to my shopping list");
  assert.deepEqual(pl.listItems, [{ list: "shopping", items: ["Eggs", "Bread", "Milk"] }]);
  const a1 = await L.addToList("shopping", ["Eggs", "Bread"]);
  const a2 = await L.addToList("Shopping list", ["Milk"]);
  assert.equal(a1.list.id, a2.list.id, "same list reused");
  assert.equal(a1.list.emoji, "🛒");
  const full = await L.getList(a1.list.id);
  assert.equal(full!.items.length, 3);
  await call({ message: { message_id: 40, chat: { id: 42 }, text: "add sunscreen to packing list" } });
  const lmsg = tgCalls.filter((c) => c.method === "sendMessage").at(-1)!;
  assert.match(String(lmsg.body.text), /📝 packing list: sunscreen/i);
  const save = (lmsg.body.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0][0];
  await call({ callback_query: { id: "cbl", data: save.callback_data, from: { id: 42 }, message: { message_id: 41, chat: { id: 42 }, text: "x" } } });
  assert.ok((await L.allLists()).find((x) => x.name === "Packing" && x.total === 1), "Telegram list add saved");

  // ---------------------------------------------------------------- Phase 6: backup, home layout
  const B = await import("../src/lib/backup");
  const dumpAll = await B.exportAll();
  assert.ok(dumpAll.data.documents.length >= 1 && dumpAll.data.lists.length >= 2, "backup includes life data");
  assert.ok(!("settings" in dumpAll.data) && !("pushSubscriptions" in dumpAll.data), "secrets left out");
  await B.sendBackup();
  const bmail = sent.at(-1)!;
  assert.match(bmail.subject, /backup/);
  assert.deepEqual(bmail.attachments?.map((a) => a.filename.replace(/\d{4}-\d{2}-\d{2}/, "D")), ["remindo-backup-D.json", "remindo-transactions-D.csv"]);
  process.env.CRON_SECRET = "test-cron";
  const weeklyCron = await import("../src/app/api/cron/weekly/route");
  const wk = await (await weeklyCron.GET(new Request("https://x/api/cron/weekly", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }))).json();
  assert.ok(wk.backup && wk.preview, "weekly cron runs preview + backup");
  const HL = await import("../src/app/api/home-layout/route");
  await HL.PUT(new Request("https://x", { method: "PUT", body: JSON.stringify({ widgets: [{ id: "spending", hidden: false }, { id: "summary", hidden: true }] }) }));
  const { getSetting } = await import("../src/lib/settings");
  assert.equal((await getSetting<{ id: string }[]>("homeWidgets"))![0].id, "spending");
  const { mergeLayout } = await import("../src/components/app/HomeWidgets");
  const merged = mergeLayout([{ id: "spending", hidden: false }, { id: "gone", hidden: false }]);
  assert.equal(merged[0].id, "spending");
  assert.ok(!merged.some((w) => w.id === "gone") && merged.some((w) => w.id === "life"), "unknown dropped, new widgets appended");

  // Snooze "until" a date/time, not a fixed 60 minutes.
  const A2 = await import("../src/lib/assistant");
  const snAt = new Date("2026-11-20T08:15:00Z"); // 1:45pm IST
  assert.equal(A2.snoozeMinutes({ date: "2026-11-21", time: "10:00" }, snAt), 20 * 60 + 15);
  assert.equal(A2.snoozeMinutes({ time: "10:00" }, snAt), 20 * 60 + 15, "past time today → tomorrow");
  assert.equal(A2.snoozeMinutes({ minutes: 15 }, snAt), 15);

  // Your own categories: add, rename (entries/budgets/favourites follow), hide built-in, delete → Other.
  const CAT = await import("../src/lib/categories");
  await CAT.addCategory({ name: "pet care", emoji: "🐶", type: "expense" });
  await assert.rejects(() => CAT.addCategory({ name: "Pet Care", emoji: "🐶", type: "expense" }), /already exists/);
  let cats = await CAT.getCategories();
  assert.ok(cats.expense.includes("Pet care") && cats.expense.at(-1) === "Other", "custom added before Other");
  const { createTransactions: ct2 } = await import("../src/lib/create");
  await ct2([{ type: "expense", amount: 800, category: "Pet care", note: "Dog food", date: local(0).date }]);
  const { budgets: bT, favourites: fT } = await import("../src/db");
  await db().insert(bT).values({ category: "Pet care", amountPaise: 300000 });
  await db().insert(fT).values({ label: "Dog food", payload: { type: "expense", amount: 800, category: "Pet care" } });
  await CAT.updateCategory("Pet care", { name: "Pets", emoji: "🐾" });
  assert.equal((await db().select().from(transactions).where(eq(transactions.note, "Dog food")))[0].category, "Pets");
  assert.equal((await db().select().from(bT).where(eq(bT.category, "Pets"))).length, 1);
  assert.equal(((await db().select().from(fT).where(eq(fT.label, "Dog food")))[0].payload as { category: string }).category, "Pets");
  assert.match(await CAT.categoryHint(), /Pets/);
  await CAT.setHidden("Fuel", true);
  cats = await CAT.getCategories();
  assert.ok(!cats.expense.includes("Fuel") && cats.hidden.includes("Fuel"));
  await assert.rejects(() => CAT.setHidden("Other", true));
  await CAT.addCategory({ name: "Fuel", emoji: "⛽", type: "expense" }); // re-adding a hidden built-in shows it again
  assert.ok((await CAT.getCategories()).expense.includes("Fuel"));
  await CAT.deleteCategory("Pets");
  assert.equal((await db().select().from(transactions).where(eq(transactions.note, "Dog food")))[0].category, "Other");
  assert.equal((await db().select().from(bT).where(eq(bT.category, "Pets"))).length, 0);

  // ---------------------------------------------------------------- QA round 1 fixes
  // Notes stay notes when their text is saved.
  const LR = await import("../src/app/api/lists/[id]/route");
  const { lists: listsT } = await import("../src/db");
  const [note] = await db().insert(listsT).values({ name: "QA note", kind: "note" }).returning();
  await LR.PATCH(new Request("https://x", { method: "PATCH", body: JSON.stringify({ body: "hello" }) }), { params: Promise.resolve({ id: note.id }) });
  const [note2] = await db().select().from(listsT).where(eq(listsT.id, note.id));
  assert.equal(note2.kind, "note");
  assert.equal(note2.body, "hello");

  // Categories are cleaned up on save.
  await CAT.addCategory({ name: "Football", emoji: "⚽", type: "expense" });
  assert.equal(await CAT.normalizeCategory("expenses: Football", "expense"), "Football");
  assert.equal(await CAT.normalizeCategory("fuel", "expense"), "Fuel");
  assert.equal(await CAT.normalizeCategory("Made up", "expense"), "Other");
  const [qaTx] = await ct2([{ type: "expense", amount: 10, category: "expenses: Fuel", note: "QA petrol", date: local(0).date }]);
  assert.equal(qaTx.category, "Fuel");
  assert.match(await CAT.categoryHint(), /"Football"/);

  // A due from Ask (remindOn null) still gets its follow-up reminder; deleting the due removes it.
  const MP2 = await import("../src/lib/moneyplus");
  const [qaDue] = await MP2.createDues([{ person: "QA Riya", direction: "they_owe", amount: 250, note: "movie", remindOn: null }]);
  assert.ok(qaDue.reminderId, "reminder created for Ask dues");
  // "Riya paid me back" → settle_due → closes the due and logs a linked Refund.
  const back = parseLocally("QA Riya paid me back the 250");
  assert.equal(back.commands?.[0]?.action, "settle_due");
  const dueCands = await A2.resolveCommand({ action: "settle_due", target: "QA Riya" });
  assert.equal(dueCands.length, 1);
  assert.equal(dueCands[0].kind, "due");
  assert.match(await A2.executeCommand({ action: "settle_due", kind: "due", id: dueCands[0].id }), /paid you back/);
  const { dues: duesT } = await import("../src/db");
  const [settled] = await db().select().from(duesT).where(eq(duesT.id, qaDue.id));
  assert.ok(settled.settledAt && settled.transactionId, "settled and linked to its refund");
  const [qaDue2] = await MP2.createDues([{ person: "QA Sam", direction: "they_owe", amount: 100 }]);
  const DR = await import("../src/app/api/dues/[id]/route");
  await DR.DELETE(new Request("https://x"), { params: Promise.resolve({ id: qaDue2.id }) });
  assert.equal((await db().select().from(reminders).where(eq(reminders.id, qaDue2.reminderId!))).length, 0, "due's reminder removed");

  // Commands only offer the best match.
  await createReminders([
    { title: "QA call plumber", date: local(60 * 24 * 3).date, time: "18:00", recurrence: "none", interval: 1, priority: "normal", category: "home" },
    { title: "QA pay electricity bill", date: local(60 * 24 * 4).date, time: "09:00", recurrence: "monthly", interval: 1, priority: "normal", category: "bills" },
  ]);
  const mv = await A2.resolveCommand({ action: "reschedule", target: "QA call plumber", date: local(60 * 24 * 5).date, time: "19:00" });
  assert.deepEqual(mv.map((c) => c.title), ["QA call plumber"]);

  // Real dates only.
  const { isoDay } = await import("../src/lib/day");
  assert.equal(isoDay().safeParse("2026-02-30").success, false);
  assert.equal(isoDay().safeParse("2028-02-29").success, true);
  assert.equal(L.personInputSchema.safeParse({ name: "QA X", birthday: "02-31" }).success, false);
  assert.equal(L.personInputSchema.safeParse({ name: "QA X", birthday: "02-29" }).success, true);

  // Medicine added after its dose time starts tomorrow.
  const { fmtLocal } = await import("../src/lib/time");
  const lateMed = await L.saveMedicine({ name: "QA late", times: ["09:00"], perDose: 1, refillAt: 0 }, undefined, new Date("2026-11-20T14:00:00Z")); // 7:30pm IST
  const [lateR] = await db().select().from(reminders).where(eq(reminders.id, lateMed!.reminderIds[0]));
  assert.equal(fmtLocal(lateR.dueAt, "yyyy-MM-dd HH:mm"), "2026-11-21 09:00");
  await L.deleteMedicine(lateMed!.id);

  // ---------------------------------------------------------------- QA round 2
  const { restoreNames } = await import("../src/lib/parse");
  assert.equal(restoreNames({ dues: [{ person: "Riya" }] }, "TEST Riya owes me 250").dues[0].person, "TEST Riya");
  assert.equal(restoreNames({ dues: [{ person: "Arun" }] }, "Paid 1200 for dinner, Arun owes 600").dues[0].person, "Arun");
  // Deleting a goal removes it for good (and from search).
  const GR = await import("../src/app/api/goals/[id]/route");
  const { goals: goalsT } = await import("../src/db");
  const [qaGoal] = await db().insert(goalsT).values({ name: "QA trip", targetPaise: 100000 }).returning();
  await GR.DELETE(new Request("https://x"), { params: Promise.resolve({ id: qaGoal.id }) });
  assert.equal((await db().select().from(goalsT).where(eq(goalsT.id, qaGoal.id))).length, 0);
  // Bad due ids → 404, not 500.
  assert.equal((await DR.DELETE(new Request("https://x"), { params: Promise.resolve({ id: "undefined" }) })).status, 404);

  // Evening review: a reminder for tomorrow ticked off today is listed under "Done today", not under Tomorrow.
  const DG = await import("../src/lib/digest");
  const [early] = await createReminders([
    { title: "QA collect from Devi", date: local(60 * 24).date, time: "19:00", recurrence: "none", interval: 1, priority: "normal", category: "money" },
  ]);
  const [earlyR] = await db().select().from(reminders).where(eq(reminders.id, early.id));
  await S.completeOccurrence(early.id, earlyR.dueAt);
  await DG.sendEveningReview();
  const evMail = sent.at(-1)!;
  const tomorrowPart = evMail.html.split("Tomorrow ·")[1] || "";
  const donePart = evMail.html.split("Done today ·")[1]?.split("Tomorrow ·")[0] || "";
  assert.ok(donePart.includes("QA collect from Devi"), "listed as done today");
  assert.ok(!tomorrowPart.split("Money today")[0].includes("QA collect from Devi"), "not listed for tomorrow");
  assert.ok(!/Done today · [1-9][\s\S]*Nothing ticked off today/.test(evMail.html), "count and list agree");

  // ---------------------------------------------------------------- Security
  process.env.APP_PASSCODE = "correct horse battery";
  const LG = await import("../src/app/api/auth/login/route");
  const loginReq = (pass: string, ip = "1.2.3.4") =>
    new Request("https://x/api/auth/login", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify({ passcode: pass }) });
  for (let i = 0; i < 5; i++) assert.equal((await LG.POST(loginReq("wrong" + i))).status, 401);
  const blocked = await LG.POST(loginReq("correct horse battery"));
  assert.equal(blocked.status, 429, "6th try from the same address is blocked, even with the right passcode");
  assert.ok(sent.at(-1)!.subject.includes("wrong passcodes"), "owner alerted");
  const okOther = await LG.POST(loginReq("correct horse battery", "5.6.7.8"));
  assert.equal(okOther.status, 200, "another address can still sign in");
  assert.equal((await LG.POST(new Request("https://x", { method: "POST", body: JSON.stringify({ passcode: { $ne: 1 } }) }))).status, 401, "non-string passcode rejected");
  // Sessions: sign out all devices invalidates existing tokens.
  const AU = await import("../src/lib/auth");
  const tok = await AU.createSession();
  assert.equal(await AU.isValidSession(tok), true);
  await AU.bumpEpoch();
  assert.equal(await AU.isValidSession(tok), false, "old session rejected after sign-out-all");
  assert.equal(await AU.isValidSession(await AU.createSession()), true);
  assert.equal(await AU.isValidSession(await AU.signToken({ did: "x", act: "done" }, "1d")), false, "action tokens can't be used as sessions");

  // ---------------------------------------------------------------- Done in one place → updated everywhere
  const [syncR] = await createReminders([
    { title: "QA sync bill", date: local(60 * 24).date, time: "10:00", recurrence: "none", interval: 1, priority: "high", category: "bills" }, // high: not held by quiet hours
  ]);
  const [syncRow] = await db().select().from(reminders).where(eq(reminders.id, syncR.id));
  const [syncDl] = await db()
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.reminderId, syncR.id), eq(deliveries.occurrenceAt, syncRow.dueAt), eq(deliveries.leadMinutes, 0)));
  // Sending stores the Telegram message so it can be updated later.
  await S.sendDelivery(syncDl.id);
  const [syncDlSent] = await db().select().from(deliveries).where(eq(deliveries.id, syncDl.id));
  assert.equal(syncDlSent.tgChatId, 42);
  assert.ok(syncDlSent.tgMessageId);
  // Done in the app → the Telegram alert loses its buttons and says so.
  const tgN = tgCalls.length;
  await S.completeOccurrence(syncR.id, syncRow.dueAt, "app");
  const syncEdit = tgCalls.slice(tgN).find((c) => c.method === "editMessageText");
  assert.ok(syncEdit && String(syncEdit.body.text).includes("Done in Remindo"), "telegram message updated");
  const syncKb = (syncEdit!.body.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard.flat();
  assert.equal(syncKb.length, 1, "Done/Snooze buttons removed");
  assert.match(syncKb[0].callback_data, /^u:/, "only an Undo button is left");
  // Undo in the app → buttons come back.
  const tgN2 = tgCalls.length;
  await S.uncompleteOccurrence(syncR.id, syncRow.dueAt);
  const restore = tgCalls.slice(tgN2).find((c) => c.method === "editMessageText");
  assert.ok((restore!.body.reply_markup as { inline_keyboard: unknown[] }).inline_keyboard.length > 0, "buttons restored");
  // Done from email twice → second time says "Already done" (no double handling).
  const { performAction } = await import("../src/lib/actions");
  assert.equal((await performAction(syncDl.id, "done", "email")).title, "Marked as done");
  const lastEdit = tgCalls.filter((c) => c.method === "editMessageText").at(-1)!;
  assert.match(String(lastEdit.body.text), /Done from email/);
  assert.equal((await performAction(syncDl.id, "done", "telegram")).title, "Already done");

  // Widget key: created on demand, checked in constant time, reset invalidates the old one.
  const WK = await import("../src/lib/widget");
  assert.equal(await WK.checkWidgetKey("anything"), false, "no key yet → nothing works");
  const wk1 = await WK.getWidgetKey();
  assert.equal(await WK.checkWidgetKey(wk1), true);
  assert.equal(await WK.checkWidgetKey(null), false);
  const wk2 = await WK.resetWidgetKey();
  assert.equal(await WK.checkWidgetKey(wk1), false, "old link stops working after reset");
  assert.equal(await WK.checkWidgetKey(wk2), true);
  // ---------------------------------------------------------------- Round 5
  // Expense → monthly bill reminder (same day next month, month-end safe), no duplicates.
  const [billTx] = await ct2([{ type: "expense", amount: 649, category: "Subscriptions", note: "Netflix", date: "2026-01-31" }]);
  const RM = await import("../src/app/api/transactions/[id]/remind/route");
  const rm1 = await (await RM.POST(new Request("https://x", { method: "POST" }), { params: Promise.resolve({ id: billTx.id }) })).json();
  assert.equal(rm1.existed, false);
  assert.equal(rm1.reminder.title, "Netflix");
  assert.equal(rm1.reminder.amountPaise, 64900);
  assert.match(rm1.reminder.rrule, /FREQ=MONTHLY.*BYMONTHDAY=28,29,30,31;BYSETPOS=-1/);
  const rm2 = await (await RM.POST(new Request("https://x", { method: "POST" }), { params: Promise.resolve({ id: billTx.id }) })).json();
  assert.equal(rm2.existed, true, "second tap doesn't duplicate");
  const { describeRrule } = await import("../src/lib/recurrence");
  assert.equal(describeRrule(rm1.reminder.rrule), "every month on the 31st (or the last day)");

  // Morning digest money tips: budget left per day + weekend average.
  const { moneyTips } = await import("../src/lib/finance");
  const fri = new Date("2026-03-13T02:00:00Z"); // Friday 7:30am IST
  await ct2([
    { type: "expense", amount: 1000, category: "Food", note: "QA wk1", date: "2026-02-28" },
    { type: "expense", amount: 500, category: "Food", note: "QA wk1b", date: "2026-03-01" },
    { type: "expense", amount: 900, category: "Food", note: "QA wk2", date: "2026-03-07" },
    { type: "expense", amount: 300, category: "Food", note: "QA mid", date: "2026-03-10" },
  ]);
  const { budgets: bT2 } = await import("../src/db");
  await db().delete(bT2);
  await db().insert(bT2).values({ category: "__total__", amountPaise: 2000000 });
  const tips = await moneyTips(fri);
  assert.ok(tips.some((t) => /budget left · about ₹[\d,]+\/day for the next 19 days/.test(t)), "budget left per day: " + tips.join(" | "));
  assert.ok(tips.some((t) => /usually spend about ₹[\d,]+ on a weekend \(last \d+ weekends\)/.test(t)), "weekend average: " + tips.join(" | "));
  await db().delete(bT2);

  // Place reminders: parse, save, fire once (Telegram copy), one-time ones switch off.
  const placeParse = parseLocally("Remind me to submit the form when I reach office");
  assert.deepEqual(placeParse.placeReminders, [{ text: "Submit the form", place: "Office", on: "arrive", repeat: false }]);
  const PL = await import("../src/lib/places");
  await PL.savePlace({ name: "office", lat: 8.5241, lng: 76.9366, radius: 150 });
  const [qaPr] = await PL.addPlaceReminders(placeParse.placeReminders!);
  assert.equal(PL.placeFor(qaPr, await PL.listPlaces())?.name, "Office");
  const tgBeforePlace = tgCalls.length;
  const fired = await PL.firePlaceReminder(qaPr.id);
  assert.equal(fired!.active, false, "one-time reminder switched off");
  assert.ok(tgCalls.slice(tgBeforePlace).some((c) => String(c.body.text).includes("Submit the form")), "telegram copy sent");
  assert.equal(await PL.firePlaceReminder(qaPr.id), null, "doesn't fire again");
  assert.ok(Math.abs(PL.distanceM({ lat: 8.5241, lng: 76.9366 }, { lat: 8.5251, lng: 76.9366 }) - 111) < 2, "distance maths");

  // ---------------------------------------------------------------- Split bills
  const SP = await import("../src/lib/splits");
  const { dues } = await import("../src/db");
  const MPs = await import("../src/lib/moneyplus");
  // Share maths.
  assert.deepEqual(SP.computeShares(100000, "equal", [{ person: "me", value: 0 }, { person: "Arun", value: 0 }, { person: "Riya", value: 0 }]).map((x) => x.sharePaise), [33334, 33333, 33333]);
  assert.deepEqual(SP.computeShares(120000, "percent", [{ person: "me", value: 40 }, { person: "Arun", value: 30 }, { person: "Riya", value: 30 }]).map((x) => x.sharePaise), [48000, 36000, 36000]);
  assert.deepEqual(SP.computeShares(90000, "shares", [{ person: "me", value: 1 }, { person: "Arun", value: 2 }]).map((x) => x.sharePaise), [30000, 60000]);
  assert.throws(() => SP.computeShares(120000, "amount", [{ person: "me", value: 500 }, { person: "Arun", value: 600 }]), /₹100 left to assign/);
  assert.throws(() => SP.computeShares(120000, "percent", [{ person: "me", value: 50 }, { person: "Arun", value: 40 }]), /90%/);
  assert.throws(() => SP.computeShares(1000, "equal", [{ person: "Arun", value: 0 }, { person: "arun", value: 0 }]), /twice/);

  // You paid ₹1,200, split equally with Arun and Riya.
  const sp1 = (await SP.createSplit({ title: "QA Dinner", amount: 1200, category: "Food", date: local(0).date, paidBy: "me", method: "equal", people: [{ person: "me" }, { person: "arun" }, { person: "Riya" }] }))!;
  assert.equal(sp1.myPaise, 40000);
  assert.equal(sp1.owedPaise, 80000);
  const [sp1Tx] = await db().select().from(transactions).where(eq(transactions.id, sp1.transactionId!));
  assert.equal(sp1Tx.amountPaise, 120000, "full bill counts as your expense");
  assert.deepEqual(sp1.dues.map((d) => [d.person, d.direction, d.amountPaise]), [["Arun", "they_owe", 40000], ["Riya", "they_owe", 40000]]);
  const [sp1R] = await db().select().from(reminders).where(eq(reminders.id, sp1.reminderId!));
  assert.match(sp1R.title, /Collect ₹400 from Arun, ₹400 from Riya/);
  // Arun pays back → income Refund; undo removes it.
  const spArunDue = sp1.dues.find((d) => d.person === "Arun")!;
  await MPs.settleDue(spArunDue.id, { log: true });
  const sp1v = (await SP.getSplit(sp1.id))!;
  assert.equal(sp1v.backPaise, 40000);
  const arunSettled = sp1v.dues.find((d) => d.person === "Arun")!;
  const [refund] = await db().select().from(transactions).where(eq(transactions.id, arunSettled.transactionId!));
  assert.equal(refund.type, "income");
  assert.equal(refund.category, "Refund");
  assert.match(refund.note!, /Arun paid back · QA Dinner/);
  await MPs.unsettleDue(spArunDue.id);
  assert.equal((await db().select().from(transactions).where(eq(transactions.id, refund.id))).length, 0, "undo removes the payback");
  // Settle up with everyone → follow-up reminder closes.
  await MPs.settlePerson("arun");
  await MPs.settlePerson("Riya");
  assert.equal((await db().select().from(reminders).where(eq(reminders.id, sp1.reminderId!)))[0].status, "archived", "reminder closes when all paid");
  // Edit: change to amounts; settled people stay ticked and their payback follows.
  const sp1e = (await SP.updateSplit(sp1.id, { title: "QA Dinner", amount: 1200, category: "Food", date: local(0).date, paidBy: "me", method: "amount", people: [{ person: "me", value: 600 }, { person: "Arun", value: 300 }, { person: "Riya", value: 300 }] }))!;
  assert.equal(sp1e.myPaise, 60000);
  const arunAfter = sp1e.dues.find((d) => d.person === "Arun")!;
  assert.ok(arunAfter.settledAt);
  assert.equal((await db().select().from(transactions).where(eq(transactions.id, arunAfter.transactionId!)))[0].amountPaise, 30000);

  // A friend paid: your share is the expense; ticking it paid doesn't add another.
  const sp2 = (await SP.createSplit({ title: "QA Groceries", amount: 500, category: "Groceries", date: local(0).date, paidBy: "Sneha", method: "equal", people: [{ person: "me" }, { person: "Sneha" }] }))!;
  const [sp2Tx] = await db().select().from(transactions).where(eq(transactions.id, sp2.transactionId!));
  assert.equal(sp2Tx.amountPaise, 25000);
  assert.match(sp2Tx.note!, /Sneha paid/);
  assert.deepEqual(sp2.dues.map((d) => [d.person, d.direction, d.amountPaise]), [["Sneha", "i_owe", 25000]]);
  const spTxCount = (await db().select().from(transactions)).length;
  await MPs.settleDue(sp2.dues[0].id, { log: true });
  assert.equal((await db().select().from(transactions)).length, spTxCount, "no second expense when you pay your share");
  await assert.rejects(() => SP.createSplit({ title: "x", amount: 100, date: local(0).date, paidBy: "Sneha", people: [{ person: "Arun" }, { person: "Sneha" }] }), /not in this split/);

  // Splitting an expense you already logged.
  const [oldTx] = await ct2([{ type: "expense", amount: 900, category: "Transport", note: "QA cab", date: local(0).date }]);
  const sp3 = (await SP.createSplit({ title: "QA cab", amount: 900, category: "Transport", date: local(0).date, people: [{ person: "me" }, { person: "Manu" }], transactionId: oldTx.id }))!;
  assert.equal(sp3.transactionId, oldTx.id, "no new expense");
  // Overview + delete (keeps the expense unless asked).
  const ov = await SP.splitsOverview();
  assert.ok(ov.people.some((p) => p.person === "Manu" && p.theyOwe === 45000));
  await SP.deleteSplit(sp3.id);
  assert.equal((await db().select().from(transactions).where(eq(transactions.id, oldTx.id))).length, 1, "expense kept");
  assert.equal((await db().select().from(dues).where(eq(dues.splitId, sp3.id))).length, 0);
  await SP.deleteSplit(sp2.id);
  assert.equal((await db().select().from(transactions).where(eq(transactions.id, sp2.transactionId!))).length, 0, "friend-paid share expense removed");

  // Settling a plain due archives its reminder (fixes old 'Collect…' showing in today's list).
  const [plain] = await MPs.createDues([{ person: "QA Hiba", direction: "they_owe", amount: 330 }]);
  await MPs.settleDue(plain.id, { log: true });
  assert.equal((await db().select().from(reminders).where(eq(reminders.id, plain.reminderId!)))[0].status, "archived");

  // ---------------------------------------------------------------- Undo everywhere
  {
  const U = await import("../src/lib/undo");
  const { activity, completions, medicines, listItems, lists, goals, goalContributions, settings, tasks } = await import("../src/db");
  const lastAct = async () => (await U.listActivity(1))[0];

  // Done → undo (and a medicine dose puts the tablet back).
  const LF = await import("../src/lib/life");
  const med = (await LF.saveMedicine({ name: "QA Undo Pill", times: ["08:00"], stock: 10, perDose: 1, refillAt: 2 }))!;
  const medR = med.reminderIds[0];
  const [medRow] = await db().select().from(reminders).where(eq(reminders.id, medR));
  const { undoId: doseUndo } = await U.track(() => S.completeOccurrence(medR, medRow.dueAt));
  assert.ok(doseUndo, "done is recorded");
  assert.equal((await db().select().from(medicines).where(eq(medicines.id, med.id)))[0].stock, 9);
  assert.equal((await lastAct()).title, "Done · 💊 QA Undo Pill");
  assert.equal((await U.undoActivity(doseUndo!)).ok, true);
  assert.equal((await db().select().from(medicines).where(eq(medicines.id, med.id)))[0].stock, 10, "tablet back");
  assert.equal((await db().select().from(completions).where(eq(completions.reminderId, medR))).length, 0, "not done any more");
  assert.equal((await U.undoActivity(doseUndo!)).title, "Already undone", "can't undo twice");
  // Un-ticking in the app closes the history entry too.
  const { undoId: d2 } = await U.track(() => S.completeOccurrence(medR, medRow.dueAt));
  await S.uncompleteOccurrence(medR, medRow.dueAt);
  assert.ok((await db().select().from(activity).where(eq(activity.id, d2!)))[0].undoneAt, "manual untick marks entry undone");

  // Delete a reminder → undo brings it back with its history.
  const [delR] = await createReminders([{ title: "QA undo delete", date: local(60 * 24).date, time: "09:00", recurrence: "none", interval: 1, priority: "normal" }]);
  await db().insert(completions).values({ reminderId: delR.id, occurrenceAt: new Date(Date.now() - 864e5) });
  const RR = await import("../src/app/api/reminders/[id]/route");
  const delRes = await RR.DELETE(new Request("https://x", { method: "DELETE" }), { params: Promise.resolve({ id: delR.id }) });
  const delUndo = delRes.headers.get("x-undo-id");
  assert.ok(delUndo, "route sends x-undo-id");
  assert.equal((await db().select().from(reminders).where(eq(reminders.id, delR.id))).length, 0);
  await U.undoActivity(delUndo!);
  const [back] = await db().select().from(reminders).where(eq(reminders.id, delR.id));
  assert.equal(back.title, "QA undo delete", "reminder restored");
  assert.ok(back.version > delR.version, "version bumped so alerts are re-planned");
  assert.equal((await db().select().from(completions).where(eq(completions.reminderId, delR.id))).length, 1, "history restored");
  assert.ok((await db().select().from(deliveries).where(eq(deliveries.reminderId, delR.id))).length > 0, "alerts planned again");

  // Edit a reminder → undo puts the old title/time back.
  const editRes = await RR.PATCH(
    new Request("https://x", { method: "PATCH", body: JSON.stringify({ title: "QA renamed", date: local(60 * 24).date, time: "11:00", recurrence: "none", interval: 1, priority: "normal" }) }),
    { params: Promise.resolve({ id: delR.id }) },
  );
  await U.undoActivity(editRes.headers.get("x-undo-id")!);
  assert.equal((await db().select().from(reminders).where(eq(reminders.id, delR.id)))[0].title, "QA undo delete", "edit undone");

  // Settle a due → undo: open again, refund entry gone, reminder back.
  const [uDue] = await MPs.createDues([{ person: "QA Undo Riya", direction: "they_owe", amount: 400 }]);
  const txBefore = (await db().select().from(transactions)).length;
  const { undoId: settleUndo } = await U.track(() => MPs.settleDue(uDue.id, { log: true }));
  assert.equal((await db().select().from(transactions)).length, txBefore + 1, "refund logged");
  assert.equal((await lastAct()).title, "QA Undo Riya paid you back ₹400");
  await U.undoActivity(settleUndo!);
  const [dueBack] = await db().select().from(dues).where(eq(dues.id, uDue.id));
  assert.equal(dueBack.settledAt, null, "due open again");
  assert.equal((await db().select().from(transactions)).length, txBefore, "refund removed");
  assert.equal((await db().select().from(reminders).where(eq(reminders.id, uDue.reminderId!)))[0].status, "active", "collect reminder back");

  // Settle up with someone = one entry; undo reopens every due.
  await MPs.createDues([{ person: "QA Undo Sam", direction: "they_owe", amount: 100 }, { person: "QA Undo Sam", direction: "they_owe", amount: 200 }]);
  const actBefore = (await db().select().from(activity)).length;
  const { undoId: allUndo } = await U.track(() => MPs.settlePerson("QA Undo Sam"));
  assert.equal((await db().select().from(activity)).length, actBefore + 1, "one history entry");
  assert.equal((await lastAct()).title, "Settled up with QA Undo Sam");
  await U.undoActivity(allUndo!);
  assert.equal((await db().select().from(dues).where(eq(dues.person, "QA Undo Sam"))).filter((d) => d.settledAt).length, 0, "both reopened");

  // Task done → undo; delete → undo.
  const TK = await import("../src/lib/tasks");
  const [uTask] = await TK.createTasks([{ title: "QA undo task", priority: "normal", focus: false }]);
  const { undoId: tUndo } = await U.track(() => TK.updateTask(uTask.id, { done: true }));
  await U.undoActivity(tUndo!);
  assert.equal((await db().select().from(tasks).where(eq(tasks.id, uTask.id)))[0].done, false);
  const { undoId: tDel } = await U.track(() => TK.deleteTask(uTask.id));
  await U.undoActivity(tDel!);
  assert.equal((await db().select().from(tasks).where(eq(tasks.id, uTask.id))).length, 1, "task back");

  // Expense added by mistake → undo removes it; edit → undo.
  const { value: [uTx], undoId: addUndo } = await U.track(() => ct2([{ type: "expense", amount: 999, category: "Food", note: "QA oops", date: local(0).date }]));
  await U.undoActivity(addUndo!);
  assert.equal((await db().select().from(transactions).where(eq(transactions.id, uTx.id))).length, 0, "added expense removed");

  // Delete a list → undo brings the items back.
  const { value: added } = await U.track(() => LF.addToList("QA undo shopping", ["eggs", "milk"]));
  const LR2 = await import("../src/app/api/lists/[id]/route");
  const ldel = await LR2.DELETE(new Request("https://x", { method: "DELETE" }), { params: Promise.resolve({ id: added.list.id }) });
  assert.equal((await db().select().from(lists).where(eq(lists.id, added.list.id))).length, 0);
  await U.undoActivity(ldel.headers.get("x-undo-id")!);
  assert.equal((await db().select().from(listItems).where(eq(listItems.listId, added.list.id))).length, 2, "list and items back");

  // Goal deleted with its savings → undo.
  const { value: g } = await U.track(async () => (await db().insert(goals).values({ name: "QA goal", targetPaise: 100000 }).returning())[0]);
  await MPs.addContribution(g.id, 500, null);
  const GR = await import("../src/app/api/goals/[id]/route");
  const gdel = await GR.DELETE(new Request("https://x", { method: "DELETE" }), { params: Promise.resolve({ id: g.id }) });
  await U.undoActivity(gdel.headers.get("x-undo-id")!);
  assert.equal((await db().select().from(goalContributions).where(eq(goalContributions.goalId, g.id))).length, 1, "goal savings back");

  // Split deleted → undo restores split, dues and expense.
  const usp = (await SP.createSplit({ title: "QA undo dinner", amount: 600, date: local(0).date, people: [{ person: "me" }, { person: "QA Undo Arun" }] }))!;
  const { undoId: spDel } = await U.track(() => SP.deleteSplit(usp.id, { deleteExpense: true }));
  await U.undoActivity(spDel!);
  assert.equal((await db().select().from(dues).where(eq(dues.splitId, usp.id))).length, 1, "split dues back");
  assert.equal((await db().select().from(transactions).where(eq(transactions.id, usp.transactionId!))).length, 1, "split expense back");

  // Places live in settings: done → undo.
  const PL = await import("../src/lib/places");
  const [pr] = await PL.addPlaceReminders([{ text: "QA undo parcel", place: "office", on: "arrive", repeat: false }]);
  const { undoId: prUndo } = await U.track(() => PL.updatePlaceReminder(pr.id, { active: false }));
  await U.undoActivity(prUndo!);
  assert.equal((await PL.listPlaceReminders()).find((x) => x.id === pr.id)!.active, true, "place reminder back on");
  void settings;

  // Budgets and categories (settings + moved entries) → undo.
  const FI = await import("../src/lib/finance");
  const budgetsBefore = await FI.getBudgets();
  const BR = await import("../src/app/api/budgets/route");
  const bres = await BR.PUT(new Request("https://x", { method: "PUT", body: JSON.stringify({ budgets: { Food: 1 } }) }));
  await U.undoActivity(bres.headers.get("x-undo-id")!);
  assert.deepEqual(await FI.getBudgets(), budgetsBefore, "budgets back");
  const CT = await import("../src/lib/categories");
  await CT.addCategory({ name: "QA Undo Cat", emoji: "🧪", type: "expense" } as never);
  const [catTx] = await ct2([{ type: "expense", amount: 10, category: "QA Undo Cat", note: "QA cat tx", date: local(0).date }]);
  const { undoId: catUndo } = await U.track(() => CT.deleteCategory("QA Undo Cat"));
  assert.equal((await db().select().from(transactions).where(eq(transactions.id, catTx.id)))[0].category, "Other");
  await U.undoActivity(catUndo!);
  assert.equal((await db().select().from(transactions).where(eq(transactions.id, catTx.id)))[0].category, "QA Undo Cat", "entries moved back");
  assert.ok((await CT.getCategories()).expense.includes("QA Undo Cat"), "category back");

  // Telegram: Undo button on a done alert, and /undo.
  const [tgR] = await createReminders([{ title: "QA tg undo", date: local(60 * 24).date, time: "10:00", recurrence: "none", interval: 1, priority: "high", category: "bills" }]);
  const [tgRow] = await db().select().from(reminders).where(eq(reminders.id, tgR.id));
  const [tgDl] = await db().select().from(deliveries).where(and(eq(deliveries.reminderId, tgR.id), eq(deliveries.occurrenceAt, tgRow.dueAt), eq(deliveries.leadMinutes, 0)));
  await S.sendDelivery(tgDl.id);
  await call({ callback_query: { id: "cbU1", data: `a:done:${tgDl.id}`, from: { id: 42 }, message: { message_id: 70, chat: { id: 42 }, text: "QA tg undo" } } });
  const tgEdit = tgCalls.filter((c) => c.method === "editMessageText").at(-1)!;
  const undoBtn = (tgEdit.body.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard.flat().find((b) => b.callback_data.startsWith("u:"));
  assert.ok(undoBtn, "Telegram shows Undo after Done");
  await call({ callback_query: { id: "cbU2", data: undoBtn!.callback_data, from: { id: 42 }, message: { message_id: 70, chat: { id: 42 }, text: "QA tg undo" } } });
  assert.equal((await db().select().from(reminders).where(eq(reminders.id, tgR.id)))[0].status, "active", "Telegram Undo reopens it");
  await S.completeOccurrence(tgR.id, tgRow.dueAt);
  await call({ message: { message_id: 71, chat: { id: 42 }, text: "/undo" } });
  assert.equal((await db().select().from(reminders).where(eq(reminders.id, tgR.id)))[0].status, "active", "/undo undoes the last change");

  // Email: the result page has an Undo button that works.
  const [emR] = await createReminders([{ title: "QA email undo", date: local(60 * 24).date, time: "10:00", recurrence: "none", interval: 1, priority: "high" }]);
  const [emRow] = await db().select().from(reminders).where(eq(reminders.id, emR.id));
  const [emDl] = await db().select().from(deliveries).where(and(eq(deliveries.reminderId, emR.id), eq(deliveries.occurrenceAt, emRow.dueAt), eq(deliveries.leadMinutes, 0)));
  const AR = await import("../src/app/api/action/route");
  const { signToken } = await import("../src/lib/auth");
  const page1 = await (await AR.POST(new Request(`https://x/api/action?t=${encodeURIComponent(await signToken({ did: emDl.id, act: "done" }, "1d"))}`, { method: "POST" }))).text();
  const undoT = decodeURIComponent(page1.match(/action\?t=([^"]+)"/)![1]);
  assert.match(page1, /Undo/, "email page offers Undo");
  await AR.POST(new Request(`https://x/api/action?t=${encodeURIComponent(undoT)}`, { method: "POST" }));
  assert.equal((await db().select().from(reminders).where(eq(reminders.id, emR.id)))[0].status, "active", "email Undo works");
  }

  // ---------------------------------------------------------------- Credit cards
  {
    const U2 = await import("../src/lib/undo");
    const { completions } = await import("../src/db");
    const CD = await import("../src/lib/cards");
    // Bill on the 20th, pay by the 5th (next month).
    assert.deepEqual(CD.cycleDates(20, 5, "2026-11-27"), { last: "2026-11-20", next: "2026-12-20", due: "2026-12-05" });
    assert.deepEqual(CD.cycleDates(20, 5, "2026-11-10"), { last: "2026-10-20", next: "2026-11-20", due: "2026-11-05" });
    // Bill on the 31st clamps to short months; due later the same month.
    assert.deepEqual(CD.cycleDates(31, 15, "2026-03-01"), { last: "2026-02-28", next: "2026-03-31", due: "2026-03-15" });
    assert.deepEqual(CD.cycleDates(1, 21, "2026-01-01"), { last: "2026-01-01", next: "2026-02-01", due: "2026-01-21" });
    const fake = { id: "c", openingBalancePaise: -100000, creditLimitPaise: 5000000, statementDay: 20, dueDay: 5 };
    const t = (type: string, amt: number, date: string, to = false) => ({ type, amountPaise: amt * 100, date, accountId: to ? "bank" : "c", toAccountId: to ? "c" : null });
    const sum = CD.summarize(fake, [t("expense", 2000, "2026-11-10"), t("expense", 500, "2026-11-25"), t("transfer", 1000, "2026-11-26", true)], "2026-11-27");
    assert.equal(sum.billPaise, 300000, "bill = owed at statement (1000 opening + 2000)");
    assert.equal(sum.duePaise, 200000, "part-paid");
    assert.equal(sum.unbilledPaise, 50000);
    assert.equal(sum.outstandingPaise, 250000);
    assert.equal(sum.availablePaise, 5000000 - 250000);
    assert.equal(sum.status, "due");
    assert.equal(CD.summarize(fake, [t("transfer", 1000, "2026-11-21", true)], "2026-11-27").status, "paid");
    assert.equal(CD.summarize(fake, [], "2026-12-07").status, "overdue");
    assert.equal(CD.summarize({ ...fake, statementDay: null, dueDay: null }, [], "2026-11-27").status, "setup");

    // End to end: card with bill/due days gets a monthly reminder with the amount due.
    const ACR = await import("../src/app/api/accounts/route");
    const bankRes = await ACR.POST(new Request("https://x", { method: "POST", body: JSON.stringify({ name: "QA Bank", kind: "bank", openingBalance: 50000 }) }));
    const bank = (await bankRes.json()).account;
    const dayOf = (offset: number) => Number(local(60 * 24 * offset).date.slice(8, 10));
    const cardRes = await ACR.POST(
      new Request("https://x", { method: "POST", body: JSON.stringify({ name: "QA Card", kind: "card", openingBalance: 0, creditLimit: 100000, statementDay: dayOf(-5), dueDay: dayOf(10), payFromId: bank.id }) }),
    );
    const card = (await cardRes.json()).account;
    const { accounts: accT } = await import("../src/db");
    let [cardRow] = await db().select().from(accT).where(eq(accT.id, card.id));
    assert.ok(cardRow.reminderId, "bill reminder created");
    // Spend before the bill date (on this bill) and today (next bill).
    await ct2([
      { type: "expense", amount: 3000, category: "Shopping", note: "QA card old", date: local(-60 * 24 * 40).date, accountId: card.id },
      { type: "expense", amount: 700, category: "Food", note: "QA card new", date: local(0).date, accountId: card.id },
    ]);
    const s1 = (await CD.cardSummaries()).get(card.id)!;
    assert.equal(s1.billPaise, 300000);
    assert.equal(s1.unbilledPaise, 70000);
    assert.equal(s1.status, "due");
    const [billR] = await db().select().from(reminders).where(eq(reminders.id, cardRow.reminderId!));
    assert.equal(billR.amountPaise, 300000, "reminder shows the amount due");
    assert.equal(billR.title, "Pay QA Card bill");
    // "Log paid" on the reminder = transfer from the bank to the card, not new spending.
    const { localToUtc } = await import("../src/lib/time");
    const occ = localToUtc(s1.dueDate!, "10:00");
    const FN = await import("../src/lib/finance");
    const { undoId: payUndo } = await U2.track(() => FN.logReminderPayment(billR.id, occ));
    const [payTx] = await db().select().from(transactions).where(eq(transactions.reminderId, billR.id));
    assert.equal(payTx.type, "transfer", "card bill payment is a transfer");
    assert.equal(payTx.accountId, bank.id);
    assert.equal(payTx.toAccountId, card.id);
    const s2 = (await CD.cardSummaries()).get(card.id)!;
    assert.equal(s2.status, "paid");
    assert.equal(s2.outstandingPaise, 70000, "only the new spend is owed");
    assert.equal((await db().select().from(completions).where(and(eq(completions.reminderId, billR.id), eq(completions.occurrenceAt, occ)))).length, 1, "this month ticked off");
    const MP3 = await import("../src/lib/moneyplus");
    const listed = (await MP3.listAccounts()).find((a) => a.id === card.id)!;
    assert.equal(listed.card?.status, "paid");
    assert.equal((await MP3.listAccounts()).find((a) => a.id === bank.id)!.balancePaise, 5000000 - 300000, "bank paid it");
    // Undo the payment → bill due again and the tick is gone.
    await U2.undoActivity(payUndo!);
    assert.equal((await CD.cardSummaries()).get(card.id)!.status, "due");
    assert.equal((await db().select().from(completions).where(and(eq(completions.reminderId, billR.id), eq(completions.occurrenceAt, occ)))).length, 0, "untick on undo");
    // Turning it into a bank account removes the bill reminder.
    const ACI = await import("../src/app/api/accounts/[id]/route");
    await ACI.PATCH(new Request("https://x", { method: "PATCH", body: JSON.stringify({ name: "QA Card", kind: "bank", openingBalance: 0 }) }), { params: Promise.resolve({ id: card.id }) });
    [cardRow] = await db().select().from(accT).where(eq(accT.id, card.id));
    assert.equal(cardRow.reminderId, null);
    assert.equal((await db().select().from(reminders).where(eq(reminders.id, billR.id))).length, 0, "reminder removed");
  }

  // ---------------------------------------------------------------- Savings
  {
    const SV = await import("../src/lib/savings");
    const U3 = await import("../src/lib/undo");
    const { savingEntries: seT, savings: svT } = await import("../src/db");
    const MP4 = await import("../src/lib/moneyplus");
    const bank = (await MP4.listAccounts()).find((a) => a.name === "QA Bank")!;
    const bankBefore = bank.balancePaise;
    // FD of ₹1,00,000 paid from the bank, maturing in 2 months → reminder.
    const fd = await SV.createSaving({ name: "QA FD", kind: "fd", institution: "SBI", ratePct: 7.1, maturityDate: local(60 * 24 * 60).date, startAmount: 100000, fromAccountId: bank.id });
    let [fdRow] = await db().select().from(svT).where(eq(svT.id, fd.id));
    assert.ok(fdRow.reminderId, "maturity reminder");
    assert.equal((await MP4.listAccounts()).find((a) => a.id === bank.id)!.balancePaise, bankBefore - 10000000, "bank paid for the FD (transfer)");
    const spentBefore = (await db().select().from(transactions).where(eq(transactions.type, "expense"))).length;
    // Interest, a top-up and a withdrawal.
    await SV.addEntry(fd.id, { type: "growth", amount: 1775, date: local(0).date, note: "Q3 interest" });
    await SV.addEntry(fd.id, { type: "deposit", amount: 5000, date: local(0).date });
    await SV.addEntry(fd.id, { type: "withdraw", amount: 2000, date: local(0).date, accountId: bank.id });
    let d = (await SV.getSaving(fd.id))!;
    assert.equal(d.valuePaise, (100000 + 1775 + 5000 - 2000) * 100);
    assert.equal(d.growthPaise, 177500);
    assert.equal(d.investedPaise, 103000 * 100);
    assert.equal((await db().select().from(transactions).where(eq(transactions.type, "expense"))).length, spentBefore, "savings never count as spending");
    await assert.rejects(() => SV.addEntry(fd.id, { type: "withdraw", amount: 999999, date: local(0).date }), /Only/);
    // Mutual fund: "it's worth ₹X now" records the profit or loss.
    const mf = await SV.createSaving({ name: "QA Index fund", kind: "mutual_fund", startAmount: 50000 });
    await SV.addEntry(mf.id, { type: "value", amount: 56000, date: local(0).date });
    await SV.addEntry(mf.id, { type: "value", amount: 54500, date: local(0).date });
    d = (await SV.getSaving(mf.id))!;
    assert.equal(d.valuePaise, 5450000);
    assert.equal(d.growthPaise, 450000, "profit 6000 then loss 1500");
    assert.equal(d.returnPct, 9);
    assert.equal(d.entries.filter((e) => e.type === "growth" && e.amountPaise < 0).length, 1, "loss is a negative growth");
    const all = await SV.listSavings();
    assert.ok(all.total.valuePaise >= d.valuePaise + 10477500);
    // Undo: delete the FD with its history → back; removing an entry also removes its bank transfer.
    const { undoId } = await U3.track(() => SV.deleteSaving(fd.id));
    assert.equal((await db().select().from(svT).where(eq(svT.id, fd.id))).length, 0);
    await U3.undoActivity(undoId!);
    assert.equal((await db().select().from(seT).where(eq(seT.savingId, fd.id))).length, 4, "FD and history back");
    const wd = (await db().select().from(seT).where(and(eq(seT.savingId, fd.id), eq(seT.type, "withdraw"))))[0];
    await SV.deleteEntry(wd.id);
    assert.equal((await db().select().from(transactions).where(eq(transactions.id, wd.transactionId!))).length, 0, "linked transfer removed");
    // Clearing the maturity date removes the reminder.
    await SV.updateSaving(fd.id, { name: "QA FD", kind: "fd", maturityDate: null });
    [fdRow] = await db().select().from(svT).where(eq(svT.id, fd.id));
    assert.equal(fdRow.reminderId, null);
  }

  console.log(`\n✓ all checks passed (${sent.length} emails captured)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
