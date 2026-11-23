import { createHmac } from "node:crypto";
import { getTelegram } from "./settings";

export type InlineButton = { text: string; callback_data: string };
export type Keyboard = InlineButton[][];

async function tg<T = unknown>(token: string, method: string, body?: object): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const json = (await res.json().catch(() => ({}))) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description || res.status}`);
  return json.result;
}

/** Secret Telegram sends back on every webhook call, derived from AUTH_SECRET. */
export function webhookSecret() {
  return createHmac("sha256", process.env.AUTH_SECRET || "").update("telegram-webhook").digest("hex").slice(0, 48);
}

export async function botApi<T = unknown>(method: string, body?: object) {
  const { token } = await getTelegram();
  if (!token) throw new Error("Telegram bot token is not set");
  return tg<T>(token, method, body);
}

export function getMe(token: string) {
  return tg<{ id: number; username: string; first_name: string }>(token, "getMe");
}

export function setWebhook(token: string, url: string) {
  return tg(token, "setWebhook", {
    url,
    secret_token: webhookSecret(),
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
}

/** Escape text for Telegram's HTML parse mode. */
export function h(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendTelegram(text: string, keyboard?: Keyboard, chatId?: number) {
  const t = await getTelegram();
  const chat = chatId ?? t.chatId;
  if (!t.token || !chat) return null;
  return tg<{ message_id: number; chat?: { id: number } }>(t.token, "sendMessage", {
    chat_id: chat,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function editTelegram(chatId: number, messageId: number, text: string, keyboard?: Keyboard) {
  return botApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: keyboard || [] },
  });
}

export function answerCallback(id: string, text?: string) {
  return botApi("answerCallbackQuery", { callback_query_id: id, text });
}

/** Download a file (e.g. a voice note) the user sent to the bot. */
export async function downloadFile(fileId: string) {
  const { token } = await getTelegram();
  const file = await botApi<{ file_path: string; file_size?: number }>("getFile", { file_id: fileId });
  if ((file.file_size || 0) > 10 * 1024 * 1024) throw new Error("File too large");
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
