# ⏰ Remindo

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

## How delivery works (and why nothing gets missed)

Vercel's free plan only runs cron jobs once a day, so delivery has three layers:

| Layer | What it does |
|---|---|
| **Vercel cron** (daily ~7am IST) | Queues every alert for the next 48h in QStash and sends the morning digest |
| **Upstash QStash** | Calls `/api/deliver` at the exact minute each alert is due |
| **cron-job.org** (every 5 min) | `/api/sweep` plans ahead and sends anything that was due but didn't go out |

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
