import { NextResponse } from "next/server";
import { agenda } from "@/lib/scheduler";
import { config } from "@/lib/config";
import { localDayBounds } from "@/lib/time";

/** Occurrences from 14 days ago to `days` ahead (default 60), with done/snooze state. */
export async function GET(req: Request) {
  const days = Math.min(Number(new URL(req.url).searchParams.get("days")) || 60, 400);
  const today = localDayBounds(new Date());
  const from = new Date(today.start.getTime() - 14 * 86400000);
  const to = new Date(today.start.getTime() + days * 86400000);
  return NextResponse.json({ tz: config.tz, items: await agenda(from, to) });
}
