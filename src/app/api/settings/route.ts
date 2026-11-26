import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { count } from "drizzle-orm";
import { db, pushSubscriptions } from "@/db";
import { getPrefs, getTelegram, setSetting } from "@/lib/settings";
import { withUndo } from "@/lib/undo-route";
import { recorded, snapSetting } from "@/lib/undo";

const time = z.string().regex(/^\d{2}:\d{2}$/);
const prefsSchema = z.object({
  channels: z.object({ email: z.boolean(), push: z.boolean(), telegram: z.boolean() }),
  quietHours: z.object({ enabled: z.boolean(), start: time, end: time }),
  emails: z.object({ morning: z.boolean(), evening: z.boolean(), weekly: z.boolean(), monthly: z.boolean(), backup: z.boolean().default(true) }),
});

/** Preferences plus connection status (never the bot token itself). */
export async function GET() {
  await connection();
  const [prefs, tg, [{ n }]] = await Promise.all([
    getPrefs(),
    getTelegram(),
    db().select({ n: count() }).from(pushSubscriptions),
  ]);
  return NextResponse.json({
    prefs,
    push: { devices: n },
    telegram: {
      hasToken: Boolean(tg.token),
      tokenFromEnv: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      botUsername: tg.botUsername || null,
      connected: Boolean(tg.chatId),
      chatName: tg.chatName || null,
    },
    // Short passcodes are easy to guess; More shows a warning (the value itself never leaves the server).
    security: { weakPasscode: (process.env.APP_PASSCODE || "").length < 10 },
  });
}

export const PUT = withUndo(async (req: Request) => {
  const parsed = prefsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  await recorded({ title: "Changed notification settings", kind: "edit" }, async (rec) => {
    rec(await snapSetting("prefs"));
    await setSetting("prefs", parsed.data);
  });
  return NextResponse.json({ prefs: parsed.data });
});
