import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { sendMonthlyReport } from "@/lib/digest";
import { runJob } from "@/lib/errors";
import { getPrefs } from "@/lib/settings";

/** Runs on the 1st (~8:30am IST): last month's money report. */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await getPrefs().catch(() => null))?.emails.monthly === false) return NextResponse.json({ skipped: "off" });
  return NextResponse.json(await runJob("monthly report", () => sendMonthlyReport()));
}
