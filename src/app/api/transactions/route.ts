import { NextResponse } from "next/server";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { accounts, db, dues, splits, transactions } from "@/db";
import { transactionInputSchema } from "@/lib/money";
import { currentMonth, listTransactions } from "@/lib/finance";
import { createTransactions } from "@/lib/create";
import { withUndo } from "@/lib/undo-route";

/** Transactions for a month (?month=YYYY-MM, default this month) plus categories used before. */
export async function GET(req: Request) {
  const month = new URL(req.url).searchParams.get("month") || currentMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  const [rows, cats] = await Promise.all([
    listTransactions(month),
    db().selectDistinct({ category: transactions.category, type: transactions.type }).from(transactions),
  ]);
  // Split bills: show "your share · ₹x back · ₹y due" under the expense.
  const ids = rows.map((r) => r.id);
  const sp = ids.length ? await db().select().from(splits).where(inArray(splits.transactionId, ids)) : [];
  const ds = sp.length ? await db().select().from(dues).where(inArray(dues.splitId, sp.map((s) => s.id))) : [];
  const withSplit = rows.map((r) => {
    const s = sp.find((x) => x.transactionId === r.id);
    if (!s) return r;
    const mine = ds.filter((d) => d.splitId === s.id);
    const theyOwe = mine.filter((d) => d.direction === "they_owe");
    return {
      ...r,
      split: {
        id: s.id,
        paidBy: s.paidBy,
        myPaise: s.myPaise,
        people: s.shares.length,
        backPaise: theyOwe.filter((d) => d.settledAt).reduce((a, d) => a + d.amountPaise, 0),
        duePaise: theyOwe.filter((d) => !d.settledAt).reduce((a, d) => a + d.amountPaise, 0),
        iOwePaise: mine.filter((d) => d.direction === "i_owe" && !d.settledAt).reduce((a, d) => a + d.amountPaise, 0),
      },
    };
  });
  // Account names, so each entry can say "UPI · SBI" or "Card · HDFC Millennia".
  const accs = await db().select({ id: accounts.id, name: accounts.name, kind: accounts.kind }).from(accounts);
  const named = withSplit.map((t) => {
    const a = accs.find((x) => x.id === t.accountId);
    const to = accs.find((x) => x.id === t.toAccountId);
    return { ...t, accountName: a?.name ?? null, accountKind: a?.kind ?? null, toAccountName: to?.name ?? null };
  });
  return NextResponse.json({ month, transactions: named, usedCategories: cats });
}

/** Add one or more: { items: TransactionInput[] } */
export const POST = withUndo(async (req: Request) => {
  const parsed = z
    .object({ items: z.array(transactionInputSchema).min(1).max(30) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  const created = await createTransactions(parsed.data.items);
  return NextResponse.json({ created });
});
