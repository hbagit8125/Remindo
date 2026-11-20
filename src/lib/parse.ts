import * as chrono from "chrono-node";
import { z } from "zod";
import { reminderInputSchema, type ReminderInput } from "./reminder-input";
import { taskInputSchema, type TaskInput } from "./tasks";
import { dueInputSchema, type DueInput } from "./moneyplus";
import { listAddSchema, type ListAdd } from "./life";
import { commandSchema, questionSchema, type Command, type Question } from "./assistant";
import {
  CATEGORY_KEYWORDS,
  DEFAULT_CATEGORIES,
  INCOME_CATEGORIES,
  transactionInputSchema,
  type TransactionInput,
} from "./money";
import { fmtLocal, localNowContext, toFakeUtc } from "./time";

const resultSchema = z.object({
  reminders: z.array(reminderInputSchema).max(20).default([]),
  transactions: z.array(transactionInputSchema).max(30).default([]),
  tasks: z.array(taskInputSchema).max(30).default([]),
  dues: z.array(dueInputSchema).max(10).default([]),
  listItems: z.array(listAddSchema).max(5).default([]),
  question: questionSchema.nullish(),
  commands: z.array(commandSchema).max(5).default([]),
});

export type ParseResult = {
  reminders: ReminderInput[];
  transactions: TransactionInput[];
  tasks: TaskInput[];
  dues?: DueInput[];
  listItems?: ListAdd[];
  question?: Question | null;
  commands?: Command[];
};

const hasContent = (d: z.infer<typeof resultSchema>) =>
  Boolean(d.reminders.length || d.transactions.length || d.tasks.length || d.dues.length || d.listItems.length || d.question || d.commands.length);

/** Your own categories, loaded once per request before the AI is called. */
let categoryExtra = "";

function systemPrompt(now = new Date()) {
  const ctx = localNowContext(now);
  return `You are a personal assistant. You turn a short note (typed or spoken, Indian English or Malayalam, amounts in rupees) into REMINDERS, TASKS and/or money TRANSACTIONS.
Right now it is ${ctx.weekday}, ${ctx.date} ${ctx.time} in timezone ${ctx.tz}. Resolve relative dates ("tomorrow", "yesterday", "next Tuesday", "on the 5th") against this.${categoryExtra}

Return ONLY JSON: {"reminders":[...], "tasks":[...], "transactions":[...], "dues":[...], "listItems":[...], "question": null | {...}, "commands":[...]}. Any list may be empty.
KEEP THE USER'S WORDS: titles, notes, names and list items must keep every meaningful word the user wrote, including names, codes and tags in capitals (e.g. "TEST", "KSEB", "Arun"). Only drop filler like "remind me to", "please", "I need to".

QUESTIONS: if they are ASKING about their own data, return only "question" (everything else empty):
{"kind": "spend" | "income" | "agenda" | "find" | "tasks" | "balance" | "goals" | "dues" | "budget",
 "category": expense category if they name one (use the category list below) or null,
 "keyword": shop/item words to filter on, or for "find" the thing to look up (e.g. "Ammu birthday"), or null,
 "from": "YYYY-MM-DD" or null, "to": "YYYY-MM-DD" or null}
Examples: "How much did I spend on food in October?" → spend, category Food, from/to = 1st–last of the most recent past October. "Spent on Swiggy last month?" → spend, keyword "Swiggy". "What's due this week?" → agenda (Mon–Sun of this week). "When is Ammu's birthday?" → find, keyword "Ammu birthday". "How much budget is left?" → budget. "Who owes me money?" → dues. "My balance?" → balance.

COMMANDS: if they want to CHANGE something that already exists, return "commands":
{"action": "complete" | "snooze" | "reschedule" | "delete" | "log_payment" | "settle_due", "target": words naming the reminder/task (for settle_due: the person's name), "date": "YYYY-MM-DD" or null, "time": "HH:mm" or null, "minutes": snooze minutes or null}
Examples: "Move the dentist to Friday 5pm" → reschedule, target "dentist", date=Friday, time 17:00. "Mark rent as paid" → two commands: log_payment "rent" and complete "rent". "Snooze gym by 30 minutes" → snooze, 30. "Cancel the plumber reminder" → delete "plumber". "Mark buy milk done" → complete "buy milk".
"Riya paid me back" / "Arun returned the 300" / "I paid Sam back" → settle_due, target = the person's name. These close an existing due; do NOT also add a transaction.

TRANSACTIONS = money that already moved: "spent", "paid", "bought", "got", "received", "credited", or a plain "<thing> <amount>" like "petrol 1200".
Each transaction:
{
  "type": "expense" | "income" (salary, credited, received, refund = income),
  "amount": number in rupees ("1.2k" = 1200, "2 lakh" = 200000),
  "category": for expenses one of ${DEFAULT_CATEGORIES.join(", ")}; for income one of ${INCOME_CATEGORIES.join(", ")},
  "note": short description like "Lunch" or "Petrol", or null,
  "merchant": shop/app name if said (Zomato, Amazon, Uber), else null,
  "method": "upi" | "card" | "cash" | "bank" if said (GPay/PhonePe/Paytm = upi), else null,
  "date": "YYYY-MM-DD", today unless they say otherwise. Never in the future.
}

REMINDERS = things to do or remember in the future. Never pick a date/time in the past: if a time today has already passed and no date was given, use tomorrow.
Each reminder:
{
  "title": short imperative title, e.g. "Pay rent", "Call Mom",
  "notes": extra details or null,
  "date": "YYYY-MM-DD" (first occurrence),
  "time": "HH:mm" 24h, or null if no time of day applies (birthdays, bills, deadlines),
  "recurrence": "none" | "daily" | "weekly" | "monthly" | "yearly",
  "interval": integer, 1 unless "every 2 weeks" etc,
  "weekdays": for weekly only, e.g. ["MO","WE","FR"], else null,
  "until": "YYYY-MM-DD" or null,
  "priority": "high" for birthdays, anniversaries, bills, payments, deadlines, exams, appointments, renewals; "low" for trivial nice-to-dos; else "normal",
  "category": one short word like "work","personal","health","finance","family","study", or null,
  "amount": rupees if it is a bill/payment to make (rent, EMI, subscription), else null,
  "leadTimes": minutes before to alert, e.g. "remind me 2 days early" -> [2880, 0]; null if not mentioned
}

TASKS = to-dos with no specific clock time: "buy milk", "finish the report by Friday", "todo: renew passport", "call the plumber sometime this week". If they give a clock time ("call mom at 7pm") it is a REMINDER instead. Bills, birthdays and other dated events stay REMINDERS.
Each task:
{
  "title": short imperative title,
  "notes": details or null,
  "dueDate": "YYYY-MM-DD" if a day/deadline is mentioned ("by Friday", "tomorrow"), else null,
  "focus": true if they say today / now / "today's list", else false,
  "priority": "high" if urgent/important, "low" if someday/maybe, else "normal"
}

DUES = money someone owes you or you owe someone: "Arun owes me 600", "I owe Priya 200".
Each due: {"person": name, "direction": "they_owe" | "i_owe", "amount": rupees, "note": what for or null, "remindOn": "YYYY-MM-DD" if they say when to collect/pay, else null}
"Paid 1200 for dinner, Arun owes 600" = one expense of 1200 AND one due (Arun, they_owe, 600, "dinner").

LIST ITEMS = things to add to a named list (shopping, packing, ideas, movies…): "add eggs and bread to shopping list", "put sunscreen on the packing list".
Each: {"list": list name without the word "list" (e.g. "shopping"), "items": ["Eggs", "Bread"]}. These are NOT tasks.

BANK / UPI SMS: if the text looks like a bank SMS ("debited", "credited", "A/c XX1234", "UPI Ref", "Avl Bal"), make ONE transaction: debited/spent/sent = expense, credited/received = income; amount from "Rs"/"INR"; merchant from the payee/VPA/"at …" name in plain words (e.g. "swiggy@icici" → "Swiggy"); method "upi" for UPI, "card" for card; date from the SMS if present. Ignore the balance amount.

Rules: "Paid rent 15000, remind me next month" = one transaction AND one monthly reminder with amount. "Netflix 649 every month on the 12th" = a monthly reminder with amount 649 (not a transaction unless they say they paid). Birthdays are yearly. "Every weekday" = weekly MO-FR.`;
}

function extractJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in model output");
  return JSON.parse(text.slice(start, end + 1));
}

/** fetch that gives up after `ms` so a slow AI never leaves you staring at "Understanding…". */
async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`timed out after ${ms / 1000}s`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export const GEMINI_PRIMARY = () => process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
export const GEMINI_BACKUP = () => process.env.GEMINI_BACKUP_MODEL || "gemini-flash-latest";

async function withGemini(text: string, model: string, timeoutMs: number): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt() }] },
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
      }),
    },
    timeoutMs,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const reason = body.match(/"status":\s*"([A-Z_]+)"/)?.[1] || "";
    throw new Error(`Gemini ${model} ${res.status} ${reason}`.trim());
  }
  const json = await res.json();
  const out = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "";
  return extractJson(out);
}

/** Paid backup (Claude Haiku). Only runs when ANTHROPIC_API_KEY is set and Gemini has failed. */
async function withClaude(text: string): Promise<unknown> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetchWithTimeout(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || "claude-haiku-5-5",
        max_tokens: 1500,
        temperature: 0.1,
        system: systemPrompt(),
        messages: [
          { role: "user", content: text },
          // Prefill so the reply starts as JSON.
          { role: "assistant", content: "{" },
        ],
      }),
    },
    12000,
  );
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const out = "{" + (json.content || []).map((c) => c.text || "").join("");
  return extractJson(out);
}

async function withGroq(text: string): Promise<unknown> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return extractJson(json?.choices?.[0]?.message?.content || "");
}

const AMOUNT_RE = /(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|lakh|lakhs|l)?\b(?!\s*(?:am|pm|th|st|nd|rd|min|hour|day|week|month))/i;
const MONEY_MOVED_RE = /\b(spent|spend|paid|pay(?:ed)?|bought|cost|got|received|credited|salary|refund)\b/i;

/** Bank/UPI SMS → one transaction. Returns null if it doesn't look like a bank SMS. */
export function parseBankSms(text: string, now = new Date()): TransactionInput | null {
  if (!/\b(debited|credited|spent|sent|received)\b/i.test(text) || !/\b(a\/c|acct|account|upi|card|avl|bal|ref)\b/i.test(text)) return null;
  const amt = text.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!amt) return null;
  const amount = Number(amt[1].replace(/,/g, ""));
  if (!amount) return null;
  const income = /\bcredited\b|\breceived\b/i.test(text) && !/\bdebited\b/i.test(text);
  const vpa = text.match(/\b(?:to|from|vpa)\s+([a-z0-9._-]+)@[a-z]+/i)?.[1];
  const at = text.match(
    /\b(?:at|to|towards|from|info[:\s-]*)\s+(?!a\/c|ac\b|acct|account|your)([A-Za-z][A-Za-z0-9 &'-]{2,30}?)(?=\s+(?:on|via|ref|upi|avl|thru|by)\b|\s*[.,(]|$)/i,
  )?.[1];
  const raw = vpa || at || null;
  const merchant = raw ? raw.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim() : null;
  const dm = text.match(/\b(\d{1,2})[-/ ](\d{1,2}|[A-Za-z]{3})[-/ ](\d{2,4})\b/);
  let date = fmtLocal(now, "yyyy-MM-dd");
  if (dm) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const mo = /^\d+$/.test(dm[2]) ? Number(dm[2]) : months.indexOf(dm[2].toLowerCase()) + 1;
    const yr = dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3]);
    if (mo >= 1 && mo <= 12 && Number(dm[1]) <= 31) {
      const cand = `${yr}-${String(mo).padStart(2, "0")}-${String(Number(dm[1])).padStart(2, "0")}`;
      if (cand <= date) date = cand;
    }
  }
  let category = "Other";
  const hay = `${merchant || ""} ${text}`.toLowerCase();
  for (const [re, cat] of CATEGORY_KEYWORDS) {
    if (re.test(hay) && cat !== "Salary") {
      category = cat;
      break;
    }
  }
  if (income) category = /salary/i.test(text) ? "Salary" : "Other";
  return transactionInputSchema.parse({
    type: income ? "income" : "expense",
    amount,
    category,
    note: merchant ? (income ? `From ${merchant}` : merchant) : income ? "Money received" : "Bank debit",
    merchant,
    method: /\bupi\b/i.test(text) ? "upi" : /\bcard\b/i.test(text) ? "card" : "bank",
    date,
  });
}

/** No-AI fallback for money: "spent 450 on lunch", "petrol 1200 yesterday". */
export function parseTransactionLocally(text: string, now = new Date()): TransactionInput | null {
  const lower = text.toLowerCase();
  const futureish = /\b(remind|every|tomorrow|next|on the \d)/i.test(lower);
  if (futureish && !MONEY_MOVED_RE.test(lower)) return null;
  const m = text.match(AMOUNT_RE);
  if (!m) return null;
  let amount = Number(m[1].replace(/,/g, ""));
  const unit = (m[2] || "").toLowerCase();
  if (unit === "k") amount *= 1000;
  if (unit.startsWith("l")) amount *= 100000;
  if (!amount) return null;

  const income = /\b(salary|received|credited|refund|got paid)\b/i.test(lower);
  let category = "Other";
  for (const [re, cat] of CATEGORY_KEYWORDS) {
    if (re.test(lower)) {
      category = cat;
      break;
    }
  }
  if (income && !(INCOME_CATEGORIES as readonly string[]).includes(category)) category = /salary/i.test(lower) ? "Salary" : "Other";
  if (!income && category === "Salary") category = "Other";

  let date = fmtLocal(now, "yyyy-MM-dd");
  if (/\byesterday\b/i.test(lower)) date = fmtLocal(new Date(now.getTime() - 86400000), "yyyy-MM-dd");
  const method = /\b(upi|gpay|phonepe|paytm)\b/i.test(lower)
    ? "upi"
    : /\bcard\b/i.test(lower)
      ? "card"
      : /\bcash\b/i.test(lower)
        ? "cash"
        : null;

  const note = text
    .replace(m[0], " ")
    .replace(/\b(spent|spend|paid|pay|bought|for|on|at|in|via|by|using|yesterday|today|upi|gpay|phonepe|paytm|card|cash|rs\.?|rupees?|inr|received|credited|got)\b/gi, " ")
    .replace(/₹/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.\-\s]+|[,.\-\s]+$/g, "");

  return transactionInputSchema.parse({
    type: income ? "income" : "expense",
    amount,
    category,
    note: note ? note[0].toUpperCase() + note.slice(1) : null,
    method,
    date,
  });
}

/** No-AI fallback: chrono-node for the date, keywords for repetition and priority. */
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Simple date ranges in plain words: today, this week, last month, "in October". */
function rangeFromText(t: string, now: Date): { from: string; to: string } | null {
  const d = (x: Date) => fmtLocal(x, "yyyy-MM-dd");
  const today = d(now);
  const lower = t.toLowerCase();
  if (/\btoday\b/.test(lower)) return { from: today, to: today };
  if (/\byesterday\b/.test(lower)) {
    const y = d(new Date(now.getTime() - 86400000));
    return { from: y, to: y };
  }
  if (/\btomorrow\b/.test(lower)) {
    const y = d(new Date(now.getTime() + 86400000));
    return { from: y, to: y };
  }
  const dow = (Number(fmtLocal(now, "i")) + 6) % 7; // 0 = Monday
  if (/\bthis week\b/.test(lower)) return { from: d(new Date(now.getTime() - dow * 86400000)), to: d(new Date(now.getTime() + (6 - dow) * 86400000)) };
  if (/\blast week\b/.test(lower)) return { from: d(new Date(now.getTime() - (dow + 7) * 86400000)), to: d(new Date(now.getTime() - (dow + 1) * 86400000)) };
  const [y, m] = today.split("-").map(Number);
  const monthRange = (yy: number, mm: number) => ({
    from: `${yy}-${String(mm).padStart(2, "0")}-01`,
    to: `${yy}-${String(mm).padStart(2, "0")}-${String(new Date(Date.UTC(yy, mm, 0)).getUTCDate()).padStart(2, "0")}`,
  });
  if (/\blast month\b/.test(lower)) return m === 1 ? monthRange(y - 1, 12) : monthRange(y, m - 1);
  if (/\bthis month\b/.test(lower)) return { from: `${today.slice(0, 7)}-01`, to: today };
  const mi = MONTHS.findIndex((mn) => new RegExp(`\\b(${mn}|${mn.slice(0, 3)})\\b`).test(lower));
  if (mi >= 0) return monthRange(mi + 1 > m ? y - 1 : y, mi + 1);
  return null;
}

/** Offline understanding of questions and edit commands. */
export function parseAssistantLocally(text: string, now = new Date()): { question?: Question; commands?: Command[] } | null {
  const t = text.trim().replace(/[?!.]+$/, "");
  const lower = t.toLowerCase();
  const range = rangeFromText(t, now);

  if (/^(how much|what did i spend|total spent|spent how much|how much have i spent)/.test(lower) || /\bhow much\b.*\b(spen[dt]|earn|receiv|got)/.test(lower)) {
    const income = /\b(earn|earned|receiv|income|got paid|salary)\b/.test(lower);
    let category: string | null = null;
    for (const [re, cat] of CATEGORY_KEYWORDS) if (re.test(lower)) {
      category = cat;
      break;
    }
    if (/budget/.test(lower)) return { question: { kind: "budget" } };
    const kw = !category ? lower.match(/\b(?:on|at)\s+([a-z][a-z ]{1,25}?)(?:\s+(?:in|this|last|today|yesterday)\b|$)/)?.[1] || null : null;
    return { question: { kind: income ? "income" : "spend", category: income ? null : category, keyword: kw, from: range?.from, to: range?.to } };
  }
  if (/^(what('?s| is)? (due|on|up|coming|planned)|what do i have|anything (due|on)|my (schedule|agenda|plan))/.test(lower))
    return { question: { kind: "agenda", from: range?.from, to: range?.to } };
  const when = t.match(/^when(?:'s| is| does| do)?\s+(.+)$/i);
  if (when) return { question: { kind: "find", keyword: when[1].replace(/\b(due|happen|coming up)\b/gi, "").trim() } };
  if (/\b(balance|how much (money )?(do i have|is in))\b/.test(lower)) return { question: { kind: "balance" } };
  if (/\b(budget)\b.*\b(left|remaining|status)|\bhow much (budget|left)\b/.test(lower)) return { question: { kind: "budget" } };
  if (/\bwho owes|\bdo i owe|\bowes me\?|\bmy dues\b/.test(lower)) return { question: { kind: "dues" } };
  if (/\b(my goals|savings goals?|goal progress)\b/.test(lower)) return { question: { kind: "goals" } };
  if (/^(what are )?my (tasks|to-?dos?)\b|^(open|pending) tasks/.test(lower)) return { question: { kind: "tasks" } };

  const back = t.match(/^(?:i\s+)?(?:paid|returned|gave)\s+(?:back\s+)?(.+?)(?:\s+back)?(?:\s+(?:the\s+)?(?:rs\.?|₹)?\s*\d[\d,]*)?$/i);
  const backTheirs = t.match(/^(.+?)\s+(?:paid|returned|gave)(?:\s+me)?\s+back\b/i) || t.match(/^(.+?)\s+(?:paid|returned|gave)\s+(?:me\s+)?(?:the\s+)?(?:rs\.?|₹)?\s*\d[\d,]*\s+back\b/i);
  if (backTheirs) return { commands: [{ action: "settle_due", target: backTheirs[1].replace(/^(so|and)\s+/i, "") }] };
  if (back && /\bback\b/i.test(t)) return { commands: [{ action: "settle_due", target: back[1] }] };
  const paid = t.match(/^mark\s+(?:the\s+)?(.+?)\s+as\s+paid$/i);
  if (paid) return { commands: [{ action: "log_payment", target: paid[1] }, { action: "complete", target: paid[1] }] };
  const done = t.match(/^(?:mark|tick(?: off)?|complete|finish(?:ed)?)\s+(?:the\s+)?(.+?)(?:\s+(?:as\s+)?(?:done|complete|completed|finished))?$/i);
  if (done && /^(mark|tick|complete|finish)/i.test(t)) return { commands: [{ action: "complete", target: done[1] }] };
  const snooze = t.match(/^snooze\s+(?:the\s+)?(.+?)\s+(?:for|by)\s+(\d+)\s*(m|min|mins|minutes?|h|hrs?|hours?)$/i);
  if (snooze) return { commands: [{ action: "snooze", target: snooze[1], minutes: Number(snooze[2]) * (/^h/i.test(snooze[3]) ? 60 : 1) }] };
  const move = t.match(/^(?:move|reschedule|shift|postpone|change)\s+(?:the\s+)?(.+?)\s+to\s+(.+)$/i);
  if (move) {
    const offsetMin = Math.round((toFakeUtc(now).getTime() - now.getTime()) / 60000);
    const when = chrono.parse(move[2], { instant: now, timezone: offsetMin }, { forwardDate: true })[0];
    if (when) {
      const dt = when.start.date();
      return {
        commands: [
          {
            action: "reschedule",
            target: move[1],
            date: when.start.isCertain("day") || when.start.isCertain("weekday") ? fmtLocal(dt, "yyyy-MM-dd") : null,
            time: when.start.isCertain("hour") ? fmtLocal(dt, "HH:mm") : null,
          },
        ],
      };
    }
  }
  const del = t.match(/^(?:delete|remove|cancel)\s+(?:the\s+)?(.+?)(?:\s+(?:reminder|task))?$/i);
  if (del) return { commands: [{ action: "delete", target: del[1] }] };
  return null;
}

export function parseLocally(text: string, now = new Date()): ParseResult {
  const asked = parseAssistantLocally(text, now);
  if (asked) return { reminders: [], transactions: [], tasks: [], dues: [], question: asked.question || null, commands: asked.commands || [] };
  const sms = parseBankSms(text, now);
  if (sms) return { reminders: [], transactions: [sms], tasks: [], dues: [] };
  // "Call mom at 7, and spent 50 on tea" → handle each part separately.
  const parts = text
    .split(/\s*(?:,\s*and\s+|;\s*|\n+|\.\s+(?=\S)|,\s*(?=(?:also|then|plus)\b)|\s+and\s+(?=(?:spent|paid|bought|got|received|remind|call|pay)\b)|,\s*(?=(?:\w+\s+owes\b|i\s+owe\b)))/i)
    .map((p) => p.replace(/^(?:also|then|plus)\s+/i, "").trim())
    .filter((p) => p.length > 2);
  const result: ParseResult = { reminders: [], transactions: [], tasks: [], dues: [], listItems: [] };
  for (const part of parts.length ? parts : [text]) {
    const li = part.match(/^\s*(?:add|put)\s+(.+?)\s+(?:to|on|in)\s+(?:my\s+|the\s+)?([\w ]{1,30}?)\s+list\s*$/i);
    if (li) {
      const items = li[1].split(/\s*(?:,|\band\b|&)\s*/i).map((x) => x.trim()).filter(Boolean).map((x) => x[0].toUpperCase() + x.slice(1));
      result.listItems!.push({ list: li[2].trim(), items });
      continue;
    }
    const owe = part.match(/^\s*(?:(\w[\w ]{0,30}?)\s+owes(?:\s+me)?|i\s+owe\s+(\w[\w ]{0,30}?))\s+(?:rs\.?|₹)?\s*([\d,]+)/i);
    if (owe) {
      result.dues!.push(
        dueInputSchema.parse({
          person: (owe[1] || owe[2]).trim().replace(/\b\w/g, (c) => c.toUpperCase()),
          direction: owe[1] ? "they_owe" : "i_owe",
          amount: Number(owe[3].replace(/,/g, "")),
        }),
      );
      continue;
    }
    const tx = parseTransactionLocally(part, now);
    if (tx) {
      result.transactions.push(tx);
      continue;
    }
    const task = parseTaskLocally(part, now);
    if (task) result.tasks.push(task);
    else result.reminders.push(...parseReminderLocally(part, now));
  }
  return result;
}

/** "todo: buy milk", "add task finish report by friday", "buy milk" (no time) → task. */
export function parseTaskLocally(text: string, now = new Date()): TaskInput | null {
  const explicit = /^\s*(?:to-?do|task|add (?:a )?task|add to (?:my )?(?:list|tasks))\s*[:\-]?\s*/i;
  const isExplicit = explicit.test(text);
  const rest = text.replace(explicit, "").trim();
  const offsetMin = Math.round((toFakeUtc(now).getTime() - now.getTime()) / 60000);
  const found = chrono.parse(rest, { instant: now, timezone: offsetMin }, { forwardDate: true })[0];
  const hasTime = Boolean(found?.start.isCertain("hour"));
  // Plain errands with no clock time ("buy milk", "pick up laundry") are tasks too.
  const errand = /^(?:buy|get|pick up|collect|finish|complete|clean|fix|book|order|send|email|write|read|study|renew|submit)\b/i.test(rest);
  if (!isExplicit && (!errand || hasTime || /\b(every|daily|weekly|monthly|yearly|birthday)\b/i.test(rest))) return null;
  if (hasTime) return null;
  let title = rest;
  let dueDate: string | null = null;
  if (found) {
    dueDate = fmtLocal(found.start.date(), "yyyy-MM-dd");
    title = (rest.slice(0, found.index) + rest.slice(found.index + found.text.length)).replace(/\b(by|on|before)\s*$/i, "");
  }
  title = title
    .replace(/\b(urgent|asap|important|today)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.\-\s]+|[,.\-\s]+$/g, "");
  if (!title) return null;
  const today = /\btoday\b/i.test(rest);
  return taskInputSchema.parse({
    title: title[0].toUpperCase() + title.slice(1),
    dueDate,
    focus: today,
    priority: /\b(urgent|asap|important)\b/i.test(rest) ? "high" : "normal",
  });
}

function parseReminderLocally(text: string, now: Date): ReminderInput[] {
  const offsetMin = Math.round((toFakeUtc(now).getTime() - now.getTime()) / 60000);
  const results = chrono.parse(text, { instant: now, timezone: offsetMin }, { forwardDate: true });
  const r = results[0];
  const lower = text.toLowerCase();

  let date = fmtLocal(now, "yyyy-MM-dd");
  let time: string | null = null;
  let title = text;
  if (r) {
    const d = r.start.date();
    date = fmtLocal(d, "yyyy-MM-dd");
    if (r.start.isCertain("hour")) time = fmtLocal(d, "HH:mm");
    title = (text.slice(0, r.index) + text.slice(r.index + r.text.length)).trim();
  } else {
    // "on the 5th" style day-of-month, which chrono doesn't catch.
    const m = text.match(/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/i);
    if (m) {
      const day = Number(m[1]);
      const [y, mo, today] = fmtLocal(now, "yyyy-MM-dd").split("-").map(Number);
      let year = y, month = mo;
      if (day <= today) month++;
      if (month > 12) { month = 1; year++; }
      date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      title = text.replace(m[0], " ");
    }
  }

  let recurrence: ReminderInput["recurrence"] = "none";
  if (/\b(every ?day|daily)\b/.test(lower)) recurrence = "daily";
  else if (/\b(every ?week|weekly)\b/.test(lower)) recurrence = "weekly";
  else if (/\b(every ?month|monthly)\b/.test(lower)) recurrence = "monthly";
  else if (/\b(every ?year|yearly|annual|birthday|anniversary)\b/.test(lower)) recurrence = "yearly";

  const high = /\b(birthday|anniversary|bill|pay|rent|emi|due|deadline|exam|renew|appointment|interview|urgent|important)\b/.test(lower);

  title = title
    .replace(/\b(remind me (to|about)?|every ?(day|week|month|year)|daily|weekly|monthly|yearly|at|on)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.\-\s]+|[,.\-\s]+$/g, "");

  if (time && !r?.start.isCertain("day") && fmtLocal(now, "yyyy-MM-dd") === date && time <= fmtLocal(now, "HH:mm")) {
    date = fmtLocal(new Date(now.getTime() + 86400000), "yyyy-MM-dd");
  }

  return [
    reminderInputSchema.parse({
      title: title ? title[0].toUpperCase() + title.slice(1) : "Reminder",
      date,
      time,
      recurrence,
      interval: 1,
      priority: high ? "high" : "normal",
    }),
  ];
}

/**
 * AI chain, cheapest first: Gemini (free) → a second Gemini model (free, used
 * when the first is busy) → Claude Haiku (paid, only if a key is set) → Groq
 * (if a key is set) → the offline parser. Each step has a time limit so the
 * whole thing stays quick even when Google is overloaded.
 */
export async function parsePrompt(text: string): Promise<ParseResult & { engine: string; warning?: string; errors?: string[] }> {
  categoryExtra = await import("./categories").then((m) => m.categoryHint()).catch(() => "");
  const errors: string[] = [];
  const valid = (engine: string, raw: unknown) => {
    const parsed = resultSchema.safeParse(raw);
    if (parsed.success && hasContent(parsed.data)) return { ...parsed.data, engine };
    throw new Error(parsed.success ? "nothing found" : parsed.error.issues[0]?.message);
  };
  const attempt = (engine: string, fn: () => Promise<unknown>) =>
    fn()
      .then((raw) => valid(engine, raw))
      .catch((e) => {
        errors.push(`${engine}: ${(e as Error).message}`);
        throw e;
      });

  // Gemini, with a "hedge": if the main model hasn't answered in 2.5s, the
  // backup model starts too and whichever answers first wins. Worst case ≈ 9.5s.
  if (process.env.GEMINI_API_KEY) {
    const primary = attempt("gemini", () => withGemini(text, GEMINI_PRIMARY(), 8000));
    const backup = new Promise<Awaited<typeof primary>>((resolve, reject) => {
      let started = false;
      const start = () => {
        if (started) return;
        started = true;
        attempt("gemini-backup", () => withGemini(text, GEMINI_BACKUP(), 7000)).then(resolve, reject);
      };
      const timer = setTimeout(start, 2500);
      primary.then(
        () => clearTimeout(timer),
        () => {
          clearTimeout(timer);
          start(); // main model failed fast (busy / quota) → try backup right away
        },
      );
    });
    try {
      return await Promise.any([primary, backup]);
    } catch {
      // both Gemini models failed; fall through
    }
  }
  for (const [engine, fn, enabled] of [
    ["claude", () => withClaude(text), Boolean(process.env.ANTHROPIC_API_KEY)],
    ["groq", () => withGroq(text), Boolean(process.env.GROQ_API_KEY)],
  ] as const) {
    if (!enabled) continue;
    try {
      return await attempt(engine, fn);
    } catch {
      // next
    }
  }
  console.warn("[remindo:parse] all AI engines failed:", errors.join(" | "));
  return {
    ...parseLocally(text),
    engine: "local",
    warning: "The AI is busy right now, so I used the simple parser. Please check the details before saving.",
    errors,
  };
}

/**
 * Turn a voice note into text. Gemini first (handles English, Malayalam and
 * mixed speech), then Groq's free Whisper as a backup.
 */
export async function transcribeAudio(audio: Buffer, mimeType = "audio/ogg"): Promise<string> {
  const errors: string[] = [];
  const key = process.env.GEMINI_API_KEY;
  for (const model of key ? [GEMINI_PRIMARY(), GEMINI_BACKUP()] : []) {
    if (!key) break;
    try {
      const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType, data: audio.toString("base64") } },
                {
                  text: "Transcribe this voice note exactly as spoken. It may be English, Malayalam, or a mix. Write Malayalam in Malayalam script and English in English. Return only the transcript.",
                },
              ],
            },
          ],
          generationConfig: { temperature: 0 },
        }),
      }, 20000);
      if (!res.ok) throw new Error(`Gemini ${model} ${res.status}`);
      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("").trim();
      if (text) return text;
      throw new Error("empty transcript");
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (process.env.GROQ_API_KEY) {
    try {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), "voice.ogg");
      form.append("model", "whisper-large-v3");
      const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: form,
      });
      if (!res.ok) throw new Error(`Groq ${res.status}`);
      const json = (await res.json()) as { text?: string };
      if (json.text?.trim()) return json.text.trim();
      throw new Error("empty transcript");
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  throw new Error(`Couldn't transcribe (${errors.join("; ") || "no AI key set"})`);
}

const scanSchema = z.object({ transactions: z.array(transactionInputSchema).max(5).default([]) });

/** Read a receipt / UPI screenshot with Gemini vision. Returns expense drafts to confirm. */
export async function scanReceipt(imageBase64: string, mimeType: string): Promise<{ transactions: TransactionInput[]; engine: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const ctx = localNowContext();
  const prompt = `This is a photo of a bill/receipt or a screenshot of a UPI/bank payment. Today is ${ctx.date} (${ctx.tz}).
Return ONLY JSON {"transactions":[{"type":"expense"|"income","amount":rupees (the final total paid, not subtotal),"category":one of ${DEFAULT_CATEGORIES.join(", ")},"note":short description,"merchant":shop/payee name or null,"method":"upi"|"card"|"cash"|"bank" or null,"date":"YYYY-MM-DD" (from the image, else today)}]}.
Usually exactly one transaction. A payment *received* screenshot is income. If you can't read an amount, return {"transactions":[]}.`;
  const errors: string[] = [];
  for (const model of [GEMINI_PRIMARY(), GEMINI_BACKUP()]) {
    try {
      const res = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: imageBase64 } }, { text: prompt }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0 },
          }),
        },
        20000,
      );
      if (!res.ok) throw new Error(`Gemini ${model} ${res.status}`);
      const json = await res.json();
      const out = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "";
      const parsed = scanSchema.safeParse(extractJson(out));
      if (parsed.success) return { transactions: parsed.data.transactions, engine: model };
      errors.push(`${model}: bad output`);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  throw new Error(`Couldn't read the image (${errors.join("; ")})`);
}
