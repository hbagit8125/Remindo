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
  return NextResponse.json(await runJob("sweep", () => sweep()));
}
