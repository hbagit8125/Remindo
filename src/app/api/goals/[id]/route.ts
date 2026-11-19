import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, goals } from "@/db";
import { addContribution, goalInputSchema } from "@/lib/moneyplus";
import { toPaise } from "@/lib/money";

type Ctx = { params: Promise<{ id: string }> };

/** Add money to the goal: { amount, note? } (negative to withdraw). */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = z
    .object({ amount: z.coerce.number().refine((n) => n !== 0).refine((n) => Math.abs(n) <= 1e9), note: z.string().max(200).nullish() })
    .safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Enter an amount" }, { status: 400 });
  return NextResponse.json({ contribution: await addContribution(id, p.data.amount, p.data.note || null) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = goalInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  const [g] = await db()
    .update(goals)
    .set({ name: p.data.name, emoji: p.data.emoji || null, targetPaise: toPaise(p.data.target), deadline: p.data.deadline || null })
    .where(eq(goals.id, id))
    .returning();
  return NextResponse.json({ goal: g });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await db().update(goals).set({ archived: true }).where(eq(goals.id, id));
  return NextResponse.json({ ok: true });
}
