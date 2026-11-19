import { connection, NextResponse } from "next/server";
import { db, goals } from "@/db";
import { goalInputSchema, listGoals } from "@/lib/moneyplus";
import { toPaise } from "@/lib/money";

export async function GET() {
  await connection();
  return NextResponse.json({ goals: await listGoals() });
}

export async function POST(req: Request) {
  const p = goalInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  const [g] = await db()
    .insert(goals)
    .values({ name: p.data.name, emoji: p.data.emoji || null, targetPaise: toPaise(p.data.target), deadline: p.data.deadline || null })
    .returning();
  return NextResponse.json({ goal: g });
}
