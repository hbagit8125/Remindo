import * as chrono from "chrono-node";
import { z } from "zod";
import { reminderInputSchema, type ReminderInput } from "./reminder-input";
import { fmtLocal, localNowContext, toFakeUtc } from "./time";

const resultSchema = z.object({ items: z.array(reminderInputSchema).max(20) });

function systemPrompt(now = new Date()) {
  const ctx = localNowContext(now);
  return `You turn a person's short note (typed or spoken) into reminders.
Right now it is ${ctx.weekday}, ${ctx.date} ${ctx.time} in timezone ${ctx.tz}. Resolve relative dates ("tomorrow", "next Tuesday", "in 2 hours", "on the 5th") against this. Never pick a date/time in the past: if a time today has already passed and no date was given, use tomorrow.

Return ONLY JSON: {"items":[ ... ]}. One item per distinct reminder. Each item:
{
  "title": short imperative title, e.g. "Pay rent", "Call Mom", "Dentist appointment",
  "notes": extra details or null,
  "date": "YYYY-MM-DD" (first occurrence),
  "time": "HH:mm" 24h, or null if no time of day applies (birthdays, bills, deadlines without time),
  "recurrence": "none" | "daily" | "weekly" | "monthly" | "yearly",
  "interval": integer, 1 unless they say "every 2 weeks" etc,
  "weekdays": for weekly only, e.g. ["MO","WE","FR"], else null,
  "until": "YYYY-MM-DD" or null,
  "priority": "high" for birthdays, anniversaries, bills, payments, deadlines, exams, appointments, renewals, anything with money or a penalty; "low" for trivial nice-to-dos; otherwise "normal",
  "category": one short word like "work","personal","health","finance","family","study", or null,
  "leadTimes": minutes before to alert, e.g. "remind me 2 days early" -> [2880, 0]; "30 min before" -> [30, 0]; null if not mentioned
}
Birthdays and anniversaries are yearly. "Every weekday" is weekly with MO-FR.`;
}

function extractJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in model output");
  return JSON.parse(text.slice(start, end + 1));
}

async function withGemini(text: string): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt() }] },
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const out = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "";
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

/** No-AI fallback: chrono-node for the date, keywords for repetition and priority. */
export function parseLocally(text: string, now = new Date()): ReminderInput[] {
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

export async function parsePrompt(text: string): Promise<{ items: ReminderInput[]; engine: string; warning?: string }> {
  const errors: string[] = [];
  for (const [engine, fn] of [
    ["gemini", withGemini],
    ["groq", withGroq],
  ] as const) {
    try {
      const raw = await fn(text);
      const parsed = resultSchema.safeParse(raw);
      if (parsed.success && parsed.data.items.length) return { items: parsed.data.items, engine };
      errors.push(`${engine}: ${parsed.success ? "no items" : parsed.error.issues[0]?.message}`);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return {
    items: parseLocally(text),
    engine: "local",
    warning: `AI unavailable, used simple parser. Check the details. (${errors.join("; ").slice(0, 200)})`,
  };
}

