import { NextResponse } from "next/server";
import { yearInsights } from "@/lib/moneyplus";
import { fmtLocal } from "@/lib/time";

export async function GET(req: Request) {
  const y = Number(new URL(req.url).searchParams.get("year")) || Number(fmtLocal(new Date(), "yyyy"));
  if (y < 2000 || y > 2100) return NextResponse.json({ error: "Bad year" }, { status: 400 });
  return NextResponse.json(await yearInsights(y));
}
