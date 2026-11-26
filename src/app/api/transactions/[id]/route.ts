import { normalizeCategory } from "@/lib/categories";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, transactions } from "@/db";
import { transactionInputSchema } from "@/lib/money";
import { checkBudgetAlerts, inputToTxRow, monthOf } from "@/lib/finance";
import { withUndo } from "@/lib/undo-route";
import { changeRow, money } from "@/lib/undo";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withUndo(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const parsed = transactionInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const category = await normalizeCategory(parsed.data.category, parsed.data.type);
  const updated = await changeRow("transactions", id, (u) => (u ? `Edited ${u.type} ${money(u.amountPaise)} · ${u.note || u.category}` : null), "edit", async () => {
    const [row] = await db().update(transactions).set(inputToTxRow({ ...parsed.data, category })).where(eq(transactions.id, id)).returning();
    return row;
  });
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (updated.type === "expense") await checkBudgetAlerts([monthOf(updated.date)]).catch(() => null);
  return NextResponse.json({ transaction: updated });
});

export const DELETE = withUndo(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const [t] = await db().select().from(transactions).where(eq(transactions.id, id));
  if (t) await changeRow("transactions", id, `Deleted ${t.type} ${money(t.amountPaise)} · ${t.note || t.category}`, "delete", () => db().delete(transactions).where(eq(transactions.id, id)));
  return NextResponse.json({ ok: true });
});
