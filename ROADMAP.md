# Remindo roadmap

Ideas for growing Remindo into a full daily assistant. Everything here can stay on free tiers unless marked 💰.

**Legend:** ⭐ high value for daily use · 🧩 small (an evening) · 🏗️ bigger (a weekend+)

---

## Shipped
- [x] Reminders from text, voice or a form; recurring; early warnings; exact-time email
- [x] Done / Snooze from email, nagging for important reminders, morning digest, Sunday preview
- [x] Expenses + income, categories, payment method, CSV export
- [x] Bills linked to expenses ("Log ₹X as paid")
- [x] Monthly budgets with 80% / 100% email alerts
- [x] Home / Reminders / Money / Insights redesign, light/dark theme, swipe + undo

- [x] Simpler budget setup (card + bottom sheet)

## In progress: Phase 1 (`feature/phase1-notifications`)
- [x] Phone push notifications with Done / Snooze buttons
- [x] Telegram bot: alerts with buttons, add by text or voice note (English / Malayalam), /today
- [x] Quiet hours (push + Telegram only; email always arrives; "While you slept" in the morning digest)
- [x] Evening review email + Telegram summary
- [x] Error alerts for failing jobs
- [x] More tab with Settings; Insights moved under Money

## Agreed plan (one PR per phase)
- **Phase 2, Plan your day:** tasks + today focus, calendar (week/month), global search, home-screen shortcuts
- **Phase 3, Money+:** favourites, accounts/wallets, split & owe, savings goals, receipt scan, SMS share/forward/paste, monthly report, yearly view
- **Phase 4, Assistant:** ask questions, edit by voice, Malayalam, pattern suggestions
- **Phase 5, Life & notes:** documents/renewals, people, health/medicines, study, notes & lists
- **Phase 6, Reliability:** offline support, weekly backup email, Home widgets

---

## 1. Never miss anything (notifications)
- [ ] ⭐🏗️ **Phone push notifications** (Web Push + service worker). Alerts arrive even if you don't check email. iPhone needs the app added to the home screen.
- [ ] ⭐🧩 **Telegram bot.** Get reminders as Telegram messages, reply "done" / "snooze 1h", and add things by text or voice note. Free and very reliable.
- [ ] 🧩 **Quiet hours.** No alerts 11pm–7am except High priority; held alerts go into the morning digest.
- [ ] 🧩 **Per-reminder channel:** email, push, Telegram, or all.
- [ ] 🧩 **Smarter snooze:** "after work", "this evening", "next weekend".
- [ ] 💰 WhatsApp / SMS alerts (the paid APIs have no truly free tier).

## 2. Planning your day
- [ ] ⭐🏗️ **"Plan my day":** list tasks with rough durations; the AI fits them around fixed reminders and you accept or drag to adjust.
- [ ] ⭐🧩 **Tasks without a time** (a to-do list) alongside timed reminders, with a "today" focus list.
- [ ] 🧩 **Evening review email:** what got done, what's carried to tomorrow, today's spend.
- [ ] 🏗️ **Calendar view** (week / month) showing reminders and spending per day.
- [ ] 🏗️ **Google Calendar:** an `.ics` feed first (🧩, read-only subscribe), then two-way sync.
- [ ] 🧩 **Templates / routines:** e.g. a "Morning routine" or "Monthly bills" pack added in one tap.

## 3. Money, going deeper
- [ ] ⭐🧩 **Recurring expenses & subscriptions page:** everything that renews, monthly total, next renewal dates.
- [ ] ⭐🧩 **Quick-add favourites:** one-tap buttons for frequent entries ("Chai ₹20", "Metro ₹40").
- [ ] 🧩 **Monthly report email** on the 1st: totals, top categories, vs last month, biggest expense.
- [ ] 🧩 **Spending alerts:** unusually large expense, or a category spiking vs your average.
- [ ] 🏗️ **Receipt / UPI screenshot scan:** snap a photo and Gemini reads the amount, merchant and date.
- [ ] 🏗️ **Bank / UPI SMS import (Android):** paste or forward a debit SMS and it's auto-logged.
- [ ] 🧩 **Split & owe:** "Paid 1200 for dinner, Arun owes 600", with a reminder to collect.
- [ ] 🏗️ **Savings goals:** e.g. "₹50,000 for a trip by March"; tracks monthly saved vs target.
- [ ] 🧩 **Accounts / wallets:** balances per bank, card or cash, and transfers between them.
- [ ] 🧩 **Yearly view** and per-category trends over 6–12 months.

## 4. Smarter assistant
- [ ] ⭐🏗️ **Ask questions in plain English:** "How much did I spend on food in October?", "What's due this week?", "When is Ammu's birthday?"
- [ ] 🧩 **Edit by voice:** "Move the dentist to Friday 5pm", "Mark rent as paid".
- [ ] 🧩 **Malayalam / Hindi input** (voice and text). Gemini already understands them; mostly prompt and UI work.
- [ ] 🧩 **Suggestions from your patterns:** "You usually pay electricity around the 10th. Add a monthly reminder?"
- [ ] 🏗️ **Notes & lists:** shopping list, packing list, ideas, all addable by voice.

## 5. Life admin (important dates)
- [ ] ⭐🧩 **Documents & renewals tracker:** vehicle insurance, PUC, licence, passport, health insurance, subscriptions; expiry dates with 30/7/1-day alerts.
- [ ] 🧩 **People:** birthdays and anniversaries with a gift budget and notes.
- [ ] 🧩 **Health:** medicine reminders with refill counts, doctor appointments.
- [ ] 🧩 **Study:** IIT Madras deadlines, exam dates, assignment reminders.

## 6. App quality
- [ ] ⭐🧩 **Offline support:** open the app and add entries without internet; they sync later.
- [ ] 🧩 **Home-screen shortcuts:** long-press the app icon for "Add expense" / "Add reminder".
- [ ] 🧩 **Global search** across reminders, expenses and notes.
- [ ] 🧩 **Backup:** weekly emailed CSV/JSON backup of all data.
- [ ] 🧩 **Error alerts to you:** an email if a scheduled job fails.
- [ ] 🧩 **Better login:** passkey / fingerprint instead of typing the passcode.
- [ ] 🏗️ **Dashboard widgets:** rearrange or hide Home cards.

---

### Suggested next order
1. Phone push notifications
2. Quick-add favourites + subscriptions page
3. Documents & renewals tracker
4. "Plan my day"
5. Ask questions in plain English
