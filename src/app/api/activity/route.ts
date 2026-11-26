import { connection, NextResponse } from "next/server";
import { listActivity, UNDO_DAYS } from "@/lib/undo";

/** Your recent changes (newest first), for the History page. */
export async function GET() {
  await connection();
  const items = await listActivity(150).catch(() => null);
  // null = the history table doesn't exist yet (migration not run).
  return NextResponse.json({ items: items || [], days: UNDO_DAYS, ready: items !== null });
}
