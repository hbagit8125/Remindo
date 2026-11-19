import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { sendWeeklyPreview } from "@/lib/digest";
import { runJob } from "@/lib/errors";
import { getPrefs } from "@/lib/settings";

/** Runs Sunday evening: emails the week ahead. */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((await getPrefs().catch(() => null))?.emails.weekly === false) return NextResponse.json({ skipped: "off" });
  return NextResponse.json(await runJob("weekly preview", () => sendWeeklyPreview()));
}
