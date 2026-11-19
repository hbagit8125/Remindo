import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getMe, setWebhook, botApi } from "@/lib/telegram";
import { getTelegram, setSetting } from "@/lib/settings";
import { config } from "@/lib/config";

/**
 * Connect the bot: save the token (unless it's in env), point Telegram's webhook
 * at this app, and return a one-time t.me link. Tapping Start in Telegram links
 * your chat, and from then on the bot only answers you.
 */
export async function POST(req: Request) {
  const { token: newToken } = (await req.json().catch(() => ({}))) as { token?: string };
  const current = await getTelegram();
  const token = process.env.TELEGRAM_BOT_TOKEN || newToken?.trim() || current.token;
  if (!token || !/^\d+:[\w-]{30,}$/.test(token)) {
    return NextResponse.json({ error: "That doesn't look like a bot token. It should look like 123456789:AAH…" }, { status: 400 });
  }
  let me;
  try {
    me = await getMe(token);
  } catch {
    return NextResponse.json({ error: "Telegram rejected that token. Copy it again from @BotFather." }, { status: 400 });
  }
  if (config.appUrl.startsWith("http://")) {
    return NextResponse.json({ error: "APP_URL must be your https Vercel URL for Telegram to reach the app." }, { status: 400 });
  }
  await setWebhook(token, `${config.appUrl}/api/telegram/webhook`);
  const linkCode = randomBytes(12).toString("hex");
  await setSetting("telegram", {
    ...current,
    token: process.env.TELEGRAM_BOT_TOKEN ? undefined : token,
    botUsername: me.username,
    linkCode,
    linkExpires: Date.now() + 15 * 60_000,
  });
  return NextResponse.json({ botUsername: me.username, link: `https://t.me/${me.username}?start=${linkCode}` });
}

/** Disconnect: forget the chat and stop the webhook. */
export async function DELETE() {
  const current = await getTelegram();
  if (current.token) await botApi("deleteWebhook").catch(() => null);
  await setSetting("telegram", { token: process.env.TELEGRAM_BOT_TOKEN ? undefined : current.token, botUsername: current.botUsername });
  return NextResponse.json({ ok: true });
}
