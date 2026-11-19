import * as chrono from "chrono-node";
import { z } from "zod";
import { reminderInputSchema, type ReminderInput } from "./reminder-input";
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
});

export type ParseResult = { reminders: ReminderInput[]; transactions: TransactionInput[] };

function systemPrompt(now = new Date()) {
  const ctx = localNowContext(now);
  return `You are a personal assistant. You turn a short note (typed or spoken, Indian English, amounts in rupees) into REMINDERS and/or money TRANSACTIONS.
Right now it is ${ctx.weekday}, ${ctx.date} ${ctx.time} in timezone ${ctx.tz}. Resolve relative dates ("tomorrow", "yesterday", "next Tuesday", "on the 5th") against this.

Return ONLY JSON: {"reminders":[...], "transactions":[...]}. Either list may be empty.

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
  if (!res.ok) throw new Error(`Gemini ${model} ${res.status}`);
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
export function parseLocally(text: string, now = new Date()): ParseResult {
  // "Call mom at 7, and spent 50 on tea" → handle each part separately.
  const parts = text
    .split(/\s*(?:,\s*and\s+|;\s*|\n+|\.\s+(?=\S)|,\s*(?=(?:also|then|plus)\b)|\s+and\s+(?=(?:spent|paid|bought|got|received|remind|call|pay)\b))/i)
    .map((p) => p.replace(/^(?:also|then|plus)\s+/i, "").trim())
    .filter((p) => p.length > 2);
  const result: ParseResult = { reminders: [], transactions: [] };
  for (const part of parts.length ? parts : [text]) {
    const tx = parseTransactionLocally(part, now);
    if (tx) result.transactions.push(tx);
    else result.reminders.push(...parseReminderLocally(part, now));
  }
  return result;
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
export async function parsePrompt(text: string): Promise<ParseResult & { engine: string; warning?: string }> {
  const errors: string[] = [];
  const chain: [string, () => Promise<unknown>][] = [
    ["gemini", () => withGemini(text, GEMINI_PRIMARY(), 7000)],
    ["gemini-backup", () => withGemini(text, GEMINI_BACKUP(), 7000)],
  ];
  if (process.env.ANTHROPIC_API_KEY) chain.push(["claude", () => withClaude(text)]);
  if (process.env.GROQ_API_KEY) chain.push(["groq", () => withGroq(text)]);

  for (const [engine, fn] of chain) {
    try {
      const raw = await fn();
      const parsed = resultSchema.safeParse(raw);
      if (parsed.success && (parsed.data.reminders.length || parsed.data.transactions.length)) {
        return { ...parsed.data, engine };
      }
      errors.push(`${engine}: ${parsed.success ? "nothing found" : parsed.error.issues[0]?.message}`);
    } catch (e) {
      errors.push(`${engine}: ${(e as Error).message}`);
    }
  }
  console.warn("[remindo:parse] all AI engines failed:", errors.join(" | "));
  return {
    ...parseLocally(text),
    engine: "local",
    warning: "The AI is busy right now, so I used the simple parser. Please check the details before saving.",
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
