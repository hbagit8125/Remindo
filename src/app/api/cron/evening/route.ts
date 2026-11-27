import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { sendEveningReview } from "@/lib/digest";
import { runJob } from "@/lib/errors";
import { getPrefs } from "@/lib/settings";

/** Runs around 9pm IST: the day-in-review email (and Telegram summary). */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // SIPs/EMIs (in case the sweep isn't set up) and tomorrow's low-balance check.
  await runJob("autopay", () => import("@/lib/autopay").then((m) => m.autopayTick()));
  if ((await getPrefs().catch(() => null))?.emails.evening === false) return NextResponse.json({ skipped: "off" });
  return NextResponse.json(await runJob("evening review", () => sendEveningReview()));
}
