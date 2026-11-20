import { normalizeCategory } from "@/lib/categories";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, transactions } from "@/db";
import { transactionInputSchema } from "@/lib/money";
import { checkBudgetAlerts, inputToTxRow, monthOf } from "@/lib/finance";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = transactionInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const category = await normalizeCategory(parsed.data.category, parsed.data.type);
  const [updated] = await db().update(transactions).set(inputToTxRow({ ...parsed.data, category })).where(eq(transactions.id, id)).returning();
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (updated.type === "expense") await checkBudgetAlerts([monthOf(updated.date)]).catch(() => null);
  return NextResponse.json({ transaction: updated });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await db().delete(transactions).where(eq(transactions.id, id));
  return NextResponse.json({ ok: true });
}
