import { connection, NextResponse } from "next/server";
import { getWidgetKey, resetWidgetKey } from "@/lib/widget";

/** (Signed-in) the widget key, for the setup link in More. */
export async function GET() {
  await connection();
  return NextResponse.json({ key: await getWidgetKey() });
}

/** Reset: the old widget link stops working. */
export async function POST() {
  return NextResponse.json({ key: await resetWidgetKey() });
}
