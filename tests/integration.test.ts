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
    const result = tgMatch[1] === "getMe" ? { id: 1, username: "test_bot", first_name: "Remindo" } : { message_id: tgCalls.length };
    return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(url as string, init);
}) as typeof fetch;

async function main() {
  const pg = new PGlite();
  for (const file of ["drizzle/0000_init.sql", "drizzle/0001_expenses.sql", "drizzle/0002_notifications.sql", "drizzle/0003_tasks.sql", "drizzle/0004_money_plus.sql", "drizzle/0005_life.sql"])
    for (const stmt of readFileSync(file, "utf8").split("--> statement-breakpoint")) await pg.exec(stmt);
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
  const split = P3.parseLocally("Paid 1200 for dinner, Arun owes me 600");
  assert.equal(split.transactions[0].amount, 1200);
  assert.equal(split.dues![0].person, "Arun");

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

  console.log(`\n✓ all checks passed (${sent.length} emails captured)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
