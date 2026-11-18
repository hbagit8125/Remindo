import { NextResponse } from "next/server";
import { z } from "zod";
import { db, transactions } from "@/db";
import { transactionInputSchema } from "@/lib/money";
import { checkBudgetAlerts, currentMonth, inputToTxRow, listTransactions, monthOf } from "@/lib/finance";

/** Transactions for a month (?month=YYYY-MM, default this month) plus categories used before. */
export async function GET(req: Request) {
  const month = new URL(req.url).searchParams.get("month") || currentMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  const [rows, cats] = await Promise.all([
    listTransactions(month),
    db().selectDistinct({ category: transactions.category, type: transactions.type }).from(transactions),
  ]);
  return NextResponse.json({ month, transactions: rows, usedCategories: cats });
}

/** Add one or more: { items: TransactionInput[] } */
export async function POST(req: Request) {
  const parsed = z
    .object({ items: z.array(transactionInputSchema).min(1).max(30) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  const created = await db().insert(transactions).values(parsed.data.items.map(inputToTxRow)).returning();
  await checkBudgetAlerts(created.filter((t) => t.type === "expense").map((t) => monthOf(t.date))).catch(() => null);
  return NextResponse.json({ created });
}
