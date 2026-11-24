# ⏰ Remindo

**Reminders + expenses in one place.** Say *"Spent 450 on lunch"*, *"Salary credited 85000"* or
*"Pay rent on the 5th every month"* and Remindo files it in the right place.

A personal reminder assistant you run for free on Vercel. Type or say things like
*"Pay rent on the 5th every month, remind me 2 days early"* and it schedules them,
emails you at the right time, and keeps nagging about important ones until you
mark them done.

## Features

- **Natural-language and voice input.** Gemini (or Groq) turns a sentence into one or more reminders. You check the draft before saving. Voice uses the browser's built-in speech recognition (Chrome/Edge, Android). With no AI key, a simple built-in parser still works.
- **Recurring reminders:** daily, weekly (pick days), monthly, yearly, with an optional end date.
- **Early warnings.** Important reminders default to 1 week, 1 day and at the time. You can choose your own per reminder.
- **Exact-time emails** with one-click **Done / Snooze 15m / Snooze 1h / Tomorrow**.
- **Escalation.** A high-priority reminder that isn't marked done is re-sent after 30 minutes (twice by default).
- **Morning digest** around 7am IST (overdue, today, important this week) and a **Sunday-evening week preview**.
- **Dashboard** with Today, Upcoming, Important and All tabs, an overdue banner, and edit, snooze and undo. It's installable on your phone as an app.
- **Passcode-locked** single-user app.

## Plan your day
- **Plan tab:** Today (focus tasks + reminders + progress), Calendar (month/week, with daily spend), Tasks, Reminders.
- **Tasks** are to-dos without a clock time: "Buy milk", "Finish report by Friday". Star one to put it in today's focus; unfinished focus tasks carry over to the next day. Add them from the ＋ sheet, by voice/AI, or on Telegram.
- **Search** (🔍 or press `/`) across reminders, tasks and money, including amounts like `450`.
- **Shortcuts:** long-press the installed app icon on Android for Add expense / task / reminder / Ask.

## Money tracking

- **Same input for money:** type, speak or fill the form. The AI decides whether it's an expense, income, a reminder, or several of them.
- **Payment method** (UPI / Card / Cash / Bank) and **categories**, including your own.
- **Bills link to expenses:** give a reminder an amount. When you mark it done, one tap logs the payment.
- **Monthly budgets**, overall and per category, with an email at 80% and 100%.
- **Insights:** month total vs last month, category donut, day-by-day chart, money left after income.
- **Spending in emails:** yesterday and month-to-date in the morning digest, the last 7 days in the Sunday preview.
- **CSV export** of everything.

## Money+
- **Accounts & wallets** (bank, UPI, cash, card) with balances, and transfers between them.
- **Favourites:** one-tap "Chai ₹20" on Home; Remindo also suggests ones you log often.
- **Split & owe:** "Paid 1200 for dinner, Arun owes 600" logs the expense and tracks the due, with a reminder to follow up.
- **Savings goals** with how much to put aside per month.
- **Receipt scan** (photo → expense) in the app and on Telegram, and **bank SMS**: share or paste it and Remindo reads the amount.
- **Monthly report email** on the 1st and a **yearly view** in Insights.

## Assistant
- **Ask questions:** "How much did I spend on food this month?", "What's on Friday?", "Who owes me?" Answers come straight from your data.
- **Change things by voice or text:** "Mark gym done", "Snooze rent to tomorrow", "Move dentist to Monday 5pm". You confirm before anything changes.
- **Malayalam voice** in the app (EN / മല toggle) and on Telegram.
- **Suggestions:** notices bills you pay every month and offers to make them reminders.

## Life
More → Life:
- **Documents:** insurance, PUC, licence, passport… Reminded 30 days, 7 days, 1 day before and on the day. "Renewed" moves the date and logs the cost.
- **People:** birthdays and anniversaries every year (a week before, the day before, on the day), with age and gift ideas.
- **Health:** dose reminders for each medicine. Tap Done and the tablet count goes down; you get one refill alert when it runs low.
- **Study:** exams and assignments, reminded a week, a day and 3 hours before.
- **Notes & lists:** shopping/packing lists and quick notes. Say *"add eggs and bread to my shopping list"* in the app or on Telegram.

## Reliability
- **Works offline:** pages and your last-loaded data open without internet. Things you add or tick off while offline are saved on the phone and synced when you're back online.
- **Weekly backup email** (Sunday) with a full JSON backup and a money CSV attached. You can also download or email a backup from More.
- **Customise Home:** reorder or hide widgets, including "Coming up" (renewals, birthdays, refills).

## AI and speed
- **AI chain:** Gemini, then a second Gemini model if the first is busy, then **Claude Haiku** (optional, paid, only if `ANTHROPIC_API_KEY` is set), then an offline parser. Each step has a time limit, so a busy AI never hangs the app.
- Voice notes are transcribed by Gemini. The Claude API doesn't take audio.
- `vercel.json` runs the app in **Singapore (`sin1`)**, next to the Neon database. Keep both in the same region for fast screens.

## Notifications
- **Phone push:** More → Turn on. No keys to configure; Remindo creates its own push keys on first use.
- **Telegram:** create a bot with @BotFather, paste the token in More → Telegram → Connect, then tap Start. Only your chat is accepted. You can also set `TELEGRAM_BOT_TOKEN` in Vercel instead of pasting it.
- **Quiet hours:** hold push and Telegram at night (High priority still alerts; email always arrives).
- **Evening review** around 9pm, plus error alerts if a background job fails.

### Upgrading an existing install
Run each new file in `drizzle/` once in the Neon SQL Editor, in order (`0001_expenses.sql`, `0002_notifications.sql`, …). They only **add** tables and columns, so existing data is untouched.

## How delivery works (and why nothing gets missed)

Vercel's free plan only runs cron jobs once a day, so delivery has three layers:

| Layer | What it does |
|---|---|
| **Vercel cron** (daily ~7am IST) | Queues every alert for the next 48h in QStash and sends the morning digest |
| **Upstash QStash** | Calls `/api/deliver` at the exact minute each alert is due |
| **cron-job.org** (every 30 min) | `/api/sweep` plans ahead and sends anything that was due but didn't go out. Not more often: each run wakes the database, and Neon's free plan allows about 400 awake hours a month |

New reminders due within 48h are queued right away. Each alert is a database row
with a unique key, and sending first "claims" the row, so the layers never send
the same alert twice.

## Stack

Next.js 16 · TypeScript · Tailwind v4 · Drizzle ORM · Neon Postgres · Upstash QStash · Resend · Gemini/Groq · rrule · chrono-node

---

## Setup (about 20 minutes, all free)

### 1. Database: Neon
1. Sign up at **neon.tech** and create a project (pick the Singapore region for India).
2. Copy the connection string into `DATABASE_URL`.
3. In Neon's **SQL Editor**, run `drizzle/0000_init.sql`, then `drizzle/0001_expenses.sql`. Alternatively, use `npm run db:push` as below.
3. Create the tables (once, from your machine):
   ```bash
   npm install
   DATABASE_URL="postgresql://..." npm run db:push
   ```
   On Windows PowerShell: `$env:DATABASE_URL="postgresql://..."; npm run db:push`

### 2. Email: Resend
1. Sign up at **resend.com** with the email you want reminders sent to.
2. Create an API key and copy it into `RESEND_API_KEY`.
3. Set `NOTIFY_EMAIL` to that same email. The default sender (`onboarding@resend.dev`) can only deliver to your own account email, which is fine for personal use. If you later verify a domain, set `EMAIL_FROM`.
4. Check your spam folder the first time and mark the email "Not spam".

### 3. Exact-time triggers: Upstash QStash
1. Sign up at **upstash.com**, then open **QStash**.
2. Copy `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY`. If the console shows a regional `QSTASH_URL`, copy that too.

### 4. AI parsing: Gemini (and/or Groq)
1. **aistudio.google.com**, then **Get API key**. Copy it into `GEMINI_API_KEY`.
2. Optional backup: **console.groq.com**, then API Keys. Copy it into `GROQ_API_KEY`.

### 5. Deploy to Vercel
1. Push this repo to GitHub, then go to **vercel.com → Add New → Project** and import it.
2. Add every variable from `.env.example` under **Settings → Environment Variables**.
   - `APP_URL` = your Vercel URL, e.g. `https://reminder-assistant-xyz.vercel.app`
   - `AUTH_SECRET`, `CRON_SECRET`: random strings (`openssl rand -base64 32`)
   - `APP_PASSCODE`: what you'll type to unlock the app
3. Deploy. The two cron jobs in `vercel.json` are picked up automatically. Vercel sends `CRON_SECRET` with each call.

### 6. Safety-net sweep: cron-job.org
1. Sign up at **cron-job.org**, then **Create cronjob**.
2. URL: `https://YOUR-APP.vercel.app/api/sweep?secret=YOUR_CRON_SECRET`
3. Schedule: every 5 minutes. Save.
3. Schedule: every 30 minutes. Save. (QStash sends each alert on time; this only catches anything that slipped through.)
### 7. Test it
- Open the app, enter your passcode, then type *"test reminder in 3 minutes"*. You should get an email about 3 minutes later.
- Click **Done** in the email. The reminder shows as done on the dashboard.
- To trigger the morning digest manually:
  `curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://YOUR-APP.vercel.app/api/cron/daily`

### Install on your phone
Open the app in Chrome (Android) or Safari (iPhone) and choose **Add to Home Screen**.

---

## Free-tier headroom

| Service | Free limit | Typical personal use |
|---|---|---|
| Resend | 100 emails/day, 3,000/month | ~5–20/day |
| QStash | 1,000 messages/day | ~5–30/day |
| Gemini Flash-Lite | Rate-limited free tier | a few prompts/day |
| Neon | 0.5 GB storage | tiny |
| cron-job.org | unlimited | 288 calls/day |

## Development

```bash
npm run dev        # http://localhost:3000
npm test           # integration test on an in-memory Postgres (no accounts needed)
npm run typecheck
```

Without QStash configured, alerts are still sent by `/api/sweep`. Locally you can call it with
`curl "localhost:3000/api/sweep?secret=YOUR_CRON_SECRET"`.

## Project layout

```
src/
  app/
    page.tsx                 dashboard
    login/page.tsx           passcode screen
    api/
      parse/                 text → reminder drafts (Gemini → Groq → local parser)
      reminders/             create / list / edit / delete
      occurrence/            done / undo / snooze one occurrence
      agenda/                occurrences for the dashboard
      cron/daily, cron/weekly  Vercel cron: plan + digests
      deliver/               QStash callback → sends the email
      sweep/                 cron-job.org safety net
      action/                Done/Snooze links from emails (confirm page → POST)
  lib/
    scheduler.ts             planning, sending, escalation, snooze, agenda
    recurrence.ts            rrule expansion in local time, lead-time alerts
    parse.ts                 AI + fallback parsing
    digest.ts, email.ts      email templates
  db/schema.ts               reminders, deliveries, completions
  proxy.ts                   passcode session check
```

## Roadmap
- Web push notifications (PWA)
- "Plan my day": fit tasks into free time slots
- Telegram bot for adding reminders by voice note
- `.ics` calendar feed for Google Calendar

## Security
- **Sign-in:** one passcode (`APP_PASSCODE`, use 10+ characters). Wrong tries are rate-limited: 5 per address in 15 minutes, 20 overall per hour pauses sign-in, and you get a Telegram + email alert. Sessions are signed (`AUTH_SECRET`), httpOnly, 30 days. **More → Sign out all devices** ends every session at once.
- **Every page and API needs a session**, except endpoints that check their own proof: QStash signature (`/api/deliver`), `CRON_SECRET` (`/api/cron/*`, `/api/sweep`), Telegram's secret header plus your linked chat only (`/api/telegram/webhook`), and signed, expiring links (`/api/action`, `/api/push/action`).
- **Headers:** a strict Content-Security-Policy (same-origin only, no framing), HSTS, nosniff, Referrer-Policy, Permissions-Policy (mic/camera for this site only). API responses are `Cache-Control: private, no-store`. No cross-origin (CORS) access to the API.
- **Data:** all input is validated (zod), and queries are parameterised (Drizzle), so no SQL is built from text. React escapes everything on screen, and email/Telegram text is escaped. Secrets live only in Vercel env vars. `.env*` files are git-ignored, and the backup leaves out tokens and keys.
- If a secret ever leaks, rotate it in Vercel and redeploy. Rotating `AUTH_SECRET` signs out everyone and invalidates email links. After that, reconnect Telegram (More → Telegram).
