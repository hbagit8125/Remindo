import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { sweep } from "@/lib/scheduler";
import { runJob } from "@/lib/errors";

/**
 * Safety net, called every 5 minutes by cron-job.org (free).
 * Plans the next 48h and sends anything that was due but never went out.
 * With no QStash configured, this alone delivers every reminder (within ~5 min).
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await runJob("sweep", () => sweep());
  // SIPs/EMIs due today, and "top up" reminders for tomorrow's.
  const autopay = await runJob("autopay", () => import("@/lib/autopay").then((m) => m.autopayTick()));
  return NextResponse.json({ ...(res as object), autopay });
}
