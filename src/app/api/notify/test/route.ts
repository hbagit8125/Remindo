import { NextResponse } from "next/server";
import { sendPush } from "@/lib/push";
import { sendTelegram } from "@/lib/telegram";
import { sendEmail, layout } from "@/lib/email";
import { config } from "@/lib/config";

/** "Send test" button in Settings: tries each channel and reports what worked. */
export async function POST(req: Request) {
  const { channel } = (await req.json().catch(() => ({}))) as { channel?: "push" | "telegram" | "email" };
  const result: Record<string, string> = {};
  const run = async (name: string, fn: () => Promise<unknown>) => {
    try {
      const r = await fn();
      result[name] = r === 0 || r === null ? "not set up" : "sent";
    } catch (e) {
      result[name] = (e as Error).message;
    }
  };
  if (!channel || channel === "push")
    await run("push", () => sendPush({ title: "🔔 Remindo test", body: "Push notifications are working.", tag: "test", url: config.appUrl }));
  if (!channel || channel === "telegram") await run("telegram", () => sendTelegram("🔔 <b>Remindo test</b>\nTelegram alerts are working."));
  if (channel === "email") await run("email", () => sendEmail("🔔 Remindo test", layout("Email alerts are working", "")));
  return NextResponse.json(result);
}
