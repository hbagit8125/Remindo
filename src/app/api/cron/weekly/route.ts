import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { sendWeeklyPreview } from "@/lib/digest";
import { sendBackup } from "@/lib/backup";
import { runJob } from "@/lib/errors";
import { getPrefs } from "@/lib/settings";

/** Runs Sunday evening: emails the week ahead and a backup of your data. */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const prefs = await getPrefs().catch(() => null);
  const preview = prefs?.emails.weekly === false ? { skipped: "off" } : await runJob("weekly preview", () => sendWeeklyPreview());
  const backup = prefs?.emails.backup === false ? { skipped: "off" } : await runJob("weekly backup", () => sendBackup());
  return NextResponse.json({ preview, backup });
}
