import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { sendWeeklyPreview } from "@/lib/digest";

/** Runs Sunday evening: emails the week ahead. */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await sendWeeklyPreview());
}
