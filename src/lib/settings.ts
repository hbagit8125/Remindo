import { eq } from "drizzle-orm";
import { db, settings } from "@/db";
import { fmtLocal } from "./time";

/** User-facing preferences, editable in More → Settings. */
export type Prefs = {
  channels: { email: boolean; push: boolean; telegram: boolean };
  quietHours: { enabled: boolean; start: string; end: string };
  emails: { morning: boolean; evening: boolean; weekly: boolean; monthly: boolean; backup: boolean };
};

export const DEFAULT_PREFS: Prefs = {
  channels: { email: true, push: true, telegram: true },
  quietHours: { enabled: true, start: "23:00", end: "07:00" },
  emails: { morning: true, evening: true, weekly: true, monthly: true, backup: true },
};

/** Telegram connection details (the bot token is never sent to the browser). */
export type TelegramState = {
  token?: string;
  botUsername?: string;
  chatId?: number;
  chatName?: string;
  linkCode?: string;
  linkExpires?: number;
};

export async function getSetting<T>(key: string): Promise<T | null> {
  const [row] = await db().select().from(settings).where(eq(settings.key, key));
  return (row?.value as T) ?? null;
}

export async function setSetting<T>(key: string, value: T) {
  await db()
    .insert(settings)
    .values({ key, value: value as object })
    .onConflictDoUpdate({ target: settings.key, set: { value: value as object, updatedAt: new Date() } });
}

export async function getPrefs(): Promise<Prefs> {
  const saved = (await getSetting<Partial<Prefs>>("prefs")) || {};
  return {
    channels: { ...DEFAULT_PREFS.channels, ...saved.channels },
    quietHours: { ...DEFAULT_PREFS.quietHours, ...saved.quietHours },
    emails: { ...DEFAULT_PREFS.emails, ...saved.emails },
  };
}

export async function getTelegram(): Promise<TelegramState> {
  const saved = (await getSetting<TelegramState>("telegram")) || {};
  return { ...saved, token: process.env.TELEGRAM_BOT_TOKEN || saved.token };
}

/** Is `now` inside quiet hours? Handles windows that cross midnight (23:00–07:00). */
export function inQuietHours(q: Prefs["quietHours"], now = new Date()) {
  if (!q.enabled || q.start === q.end) return false;
  const t = fmtLocal(now, "HH:mm");
  return q.start < q.end ? t >= q.start && t < q.end : t >= q.start || t < q.end;
}

/** Remember one email per job per hour so a broken job doesn't flood your inbox. */
export async function shouldAlert(key: string, everyMs = 3600_000) {
  const last = await getSetting<number>(`alert:${key}`);
  if (last && Date.now() - last < everyMs) return false;
  await setSetting(`alert:${key}`, Date.now());
  return true;
}
