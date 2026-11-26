import { connection, NextResponse } from "next/server";
import { db, goals } from "@/db";
import { goalInputSchema, listGoals } from "@/lib/moneyplus";
import { toPaise } from "@/lib/money";
import { withUndo } from "@/lib/undo-route";
import { recorded, removed } from "@/lib/undo";

export async function GET() {
  await connection();
  return NextResponse.json({ goals: await listGoals() });
}

export const POST = withUndo(async (req: Request) => {
  const p = goalInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  const g = await recorded({ title: `Added goal “${p.data.name}”`, kind: "add" }, async (rec) => {
    const [row] = await db()
      .insert(goals)
      .values({ name: p.data.name, emoji: p.data.emoji || null, targetPaise: toPaise(p.data.target), deadline: p.data.deadline || null })
      .returning();
    rec(removed("goals", [row.id]));
    return row;
  });
  return NextResponse.json({ goal: g });
});
