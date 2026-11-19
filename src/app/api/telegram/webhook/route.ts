import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, telegramDrafts } from "@/db";
import { safeEqual } from "@/lib/auth";
import { getTelegram, setSetting } from "@/lib/settings";
import { answerCallback, downloadFile, editTelegram, h, sendTelegram, webhookSecret } from "@/lib/telegram";
import { parsePrompt, transcribeAudio, type ParseResult } from "@/lib/parse";
import { createReminders, createTransactions } from "@/lib/create";
import { createTasks, focusFrom, listTasks } from "@/lib/tasks";
import { ACTIONS, performAction, type ActionName } from "@/lib/actions";
import { agenda } from "@/lib/scheduler";
import { formatINR } from "@/lib/money";
import { config } from "@/lib/config";
import { fmtLocal, localDayBounds } from "@/lib/time";
import { reportError } from "@/lib/errors";

// Voice notes need time for download + transcription + parsing.
export const maxDuration = 60;

type TgMessage = {
  message_id: number;
  chat: { id: number; first_name?: string; username?: string };
  text?: string;
  caption?: string;
  voice?: { file_id: string; mime_type?: string; duration: number };
  audio?: { file_id: string; mime_type?: string; duration: number };
};
type TgUpdate = {
  message?: TgMessage;
  callback_query?: { id: string; data?: string; message?: TgMessage; from: { id: number } };
};

const HELP = `<b>What I can do</b>
• Send me anything to save: <i>"Spent 200 on chai"</i>, <i>"Call mom tomorrow 7pm"</i>, <i>"Buy milk"</i>, <i>"Salary credited 85000"</i>
• Send a <b>voice note</b> (English or Malayalam) and I'll do the same
• Tap the buttons on reminders to mark them done or snooze
• /today: today's focus tasks and reminders
• /help: this message`;

/** Telegram calls this for every message or button tap sent to your bot. */
export async function POST(req: Request) {
  if (!safeEqual(req.headers.get("x-telegram-bot-api-secret-token") || "", webhookSecret())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const update = (await req.json().catch(() => ({}))) as TgUpdate;
  // Always answer 200 so Telegram doesn't retry; problems are reported to you instead.
  try {
    if (update.callback_query) await onCallback(update.callback_query);
    else if (update.message) await onMessage(update.message);
  } catch (e) {
    const chat = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chat) await sendTelegram(`😕 Something went wrong: ${h((e as Error).message)}`, undefined, chat).catch(() => null);
    await reportError("telegram", (e as Error).stack || String(e));
  }
  return NextResponse.json({ ok: true });
}

async function onMessage(m: TgMessage) {
  const tg = await getTelegram();
  const text = (m.text || m.caption || "").trim();

  // Linking: the one-time code from Settings → Connect.
  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1];
    if (tg.chatId === m.chat.id) return sendTelegram(`You're already connected 👋\n\n${HELP}`, undefined, m.chat.id);
    if (!code || code !== tg.linkCode || !tg.linkExpires || Date.now() > tg.linkExpires) {
      return sendTelegram("This is a private bot. To connect, open Remindo → More → Settings → Telegram → Connect.", undefined, m.chat.id);
    }
    await setSetting("telegram", {
      ...tg,
      token: process.env.TELEGRAM_BOT_TOKEN ? undefined : tg.token,
      chatId: m.chat.id,
      chatName: m.chat.first_name || m.chat.username || "you",
      linkCode: undefined,
      linkExpires: undefined,
    });
    return sendTelegram(`✅ <b>Connected!</b> Reminders will now arrive here too.\n\n${HELP}`, undefined, m.chat.id);
  }

  // Everyone except the linked chat is ignored.
  if (!tg.chatId || m.chat.id !== tg.chatId) return;

  if (text === "/help") return sendTelegram(HELP);
  if (text === "/today") return sendTelegram(await todayText());

  let input = text;
  const voice = m.voice || m.audio;
  if (voice) {
    if (voice.duration > 120) return sendTelegram("That voice note is a bit long. Keep it under 2 minutes.");
    const audio = await downloadFile(voice.file_id);
    input = await transcribeAudio(audio, voice.mime_type || "audio/ogg");
    await sendTelegram(`🎙️ <i>“${h(input)}”</i>`);
  }
  if (!input) return sendTelegram(`I can read text and voice notes.\n\n${HELP}`);

  const parsed = await parsePrompt(input);
  if (!parsed.reminders.length && !parsed.transactions.length && !parsed.tasks.length) {
    return sendTelegram("I couldn't find a reminder or expense in that. Try: <i>Spent 150 on lunch</i> or <i>Pay rent on the 5th every month</i>");
  }
  const [draft] = await db()
    .insert(telegramDrafts)
    .values({ payload: { reminders: parsed.reminders, transactions: parsed.transactions, tasks: parsed.tasks } })
    .returning();
  const warn = parsed.engine === "local" ? "\n\n<i>⚠️ AI was unavailable, so I used the simple parser. Please check.</i>" : "";
  await sendTelegram(`${draftText(parsed)}${warn}`, [
    [
      { text: "✅ Save", callback_data: `s:${draft.id}` },
      { text: "✖ Cancel", callback_data: `c:${draft.id}` },
    ],
  ]);
}

async function onCallback(q: NonNullable<TgUpdate["callback_query"]>) {
  const tg = await getTelegram();
  const chatId = q.message?.chat.id;
  if (!tg.chatId || chatId !== tg.chatId || !q.data || !q.message) return answerCallback(q.id);
  const msg = q.message;
  const [kind, a, b] = q.data.split(":");

  // Reminder buttons: a:<action>:<deliveryId>
  if (kind === "a" && (ACTIONS as readonly string[]).includes(a) && b) {
    const res = await performAction(b, a as ActionName);
    await answerCallback(q.id, res.title);
    const base = h(msg.text || "");
    const icon = a === "done" ? "✅" : a === "log" ? "💸" : "⏰";
    const keyboard = res.canLog ? [[{ text: `Log ${formatINR(res.canLog)} as paid`, callback_data: `a:log:${b}` }]] : undefined;
    return editTelegram(chatId, msg.message_id, `${base}\n\n${icon} <b>${h(res.title)}</b>. ${h(res.message)}`, keyboard);
  }

  // Draft buttons: s:<draftId> (save) / c:<draftId> (cancel)
  if ((kind === "s" || kind === "c") && a) {
    const [draft] = await db().select().from(telegramDrafts).where(eq(telegramDrafts.id, a));
    if (!draft) {
      await answerCallback(q.id, "Already handled");
      return editTelegram(chatId, msg.message_id, h(msg.text || ""));
    }
    await db().delete(telegramDrafts).where(eq(telegramDrafts.id, a));
    if (kind === "c") {
      await answerCallback(q.id, "Cancelled");
      return editTelegram(chatId, msg.message_id, `${h(msg.text || "")}\n\n✖ <i>Cancelled</i>`);
    }
    const p = draft.payload as ParseResult;
    await createReminders(p.reminders || []);
    await createTransactions(p.transactions || []);
    await createTasks(p.tasks || []);
    await answerCallback(q.id, "Saved");
    return editTelegram(chatId, msg.message_id, `${h(msg.text || "")}\n\n✅ <b>Saved</b>`);
  }
  return answerCallback(q.id);
}

function draftText(p: ParseResult) {
  const lines: string[] = ["<b>Here's what I understood:</b>"];
  for (const t of p.transactions) {
    const inc = t.type === "income";
    lines.push(
      `${inc ? "💰" : "💸"} ${inc ? "+" : ""}${formatINR(Math.round(t.amount * 100))} · ${h(t.note || t.category)} · ${h(t.category)}${t.method ? ` · ${t.method.toUpperCase()}` : ""}${t.date !== fmtLocal(new Date(), "yyyy-MM-dd") ? ` · ${t.date}` : ""}`,
    );
  }
  for (const t of p.tasks || []) {
    lines.push(`☑️ <b>${h(t.title)}</b>${t.dueDate ? ` · by ${t.dueDate}` : ""}${t.focus ? " · today" : ""}${t.priority === "high" ? " · ❗" : ""}`);
  }
  for (const r of p.reminders) {
    const rep = r.recurrence !== "none" ? ` · repeats ${r.recurrence}` : "";
    lines.push(`⏰ <b>${h(r.title)}</b> · ${r.date}${r.time ? ` ${r.time}` : ""}${rep}${r.amount ? ` · ${formatINR(Math.round(r.amount * 100))}` : ""}${r.priority === "high" ? " · ❗" : ""}`);
  }
  return lines.join("\n");
}

async function todayText() {
  const { start, end } = localDayBounds(new Date());
  const items = await agenda(start, end);
  const focus = focusFrom(await listTasks());
  if (!items.length && !focus.length) return "Nothing scheduled today 🎉";
  return [
    `<b>Today · ${fmtLocal(new Date(), "EEE d MMM")}</b>`,
    ...(focus.length
      ? ["", "<b>Focus</b>", ...focus.map((t) => `${t.done ? "✅" : "☐"} ${h(t.title)}${t.overdue ? " · overdue" : t.carried ? " · carried over" : ""}`), "", "<b>Reminders</b>"]
      : []),
    ...items.map(
      (i) =>
        `${i.done ? "✅" : i.priority === "high" ? "❗" : "•"} ${i.allDay ? "All day" : fmtLocal(new Date(i.occurrenceAt), "h:mm a")} · ${h(i.title)}${i.recurring ? " ↻" : ""}`,
    ),
    `\n<a href="${config.appUrl}">Open Remindo</a>`,
  ].join("\n");
}

