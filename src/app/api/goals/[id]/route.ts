import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, goalContributions, goals } from "@/db";
import { addContribution, goalInputSchema } from "@/lib/moneyplus";
import { toPaise } from "@/lib/money";
import { withUndo } from "@/lib/undo-route";
import { changeRow, recorded, snap, snapWhere } from "@/lib/undo";

type Ctx = { params: Promise<{ id: string }> };

/** Add money to the goal: { amount, note? } (negative to withdraw). */
export const POST = withUndo(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const p = z
    .object({ amount: z.coerce.number().refine((n) => n !== 0).refine((n) => Math.abs(n) <= 1e9), note: z.string().max(200).nullish() })
    .safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Enter an amount" }, { status: 400 });
  return NextResponse.json({ contribution: await addContribution(id, p.data.amount, p.data.note || null) });
});

export const PATCH = withUndo(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const p = goalInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  const [g] = await changeRow("goals", id, `Edited goal “${p.data.name}”`, "edit", () =>
    db()
      .update(goals)
      .set({ name: p.data.name, emoji: p.data.emoji || null, targetPaise: toPaise(p.data.target), deadline: p.data.deadline || null })
      .where(eq(goals.id, id))
      .returning(),
  );
  return NextResponse.json({ goal: g });
});

export const DELETE = withUndo(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  // Delete for good (with its contributions), so it doesn't linger in search.
  const [cur] = await db().select().from(goals).where(eq(goals.id, id));
  if (cur)
    await recorded({ title: `Deleted goal “${cur.name}”`, kind: "delete" }, async (rec) => {
      rec({ op: "seq", ops: [(await snap("goals", [id]))!, await snapWhere("goalContributions", "goalId", id)] });
      await db().delete(goalContributions).where(eq(goalContributions.goalId, id));
      await db().delete(goals).where(eq(goals.id, id));
    });
  return NextResponse.json({ ok: true });
});
