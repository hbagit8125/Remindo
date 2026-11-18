import { NextResponse } from "next/server";
import { currentMonth, insights } from "@/lib/finance";

export async function GET(req: Request) {
  const month = new URL(req.url).searchParams.get("month") || currentMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  return NextResponse.json(await insights(month));
}
