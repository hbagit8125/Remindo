import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { planAndQueue } from "@/lib/scheduler";
import { sendDailyDigest } from "@/lib/digest";
import { runJob } from "@/lib/errors";
import { getPrefs } from "@/lib/settings";

/**
 * Runs once a day (Vercel cron, ~7am IST). Queues every alert for the next
 * 48 hours in QStash, then sends the morning digest.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const plan = await runJob("daily planning", () => planAndQueue());
  await runJob("undo history clean-up", () => import("@/lib/undo").then((u) => u.pruneActivity()));
  const prefs = await getPrefs().catch(() => null);
  const digest = prefs?.emails.morning === false ? "off" : await runJob("morning digest", () => sendDailyDigest());
  return NextResponse.json({ plan, digest });
}
