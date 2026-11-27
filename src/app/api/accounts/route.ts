import { connection, NextResponse } from "next/server";
import { db, accounts } from "@/db";
import { accountInputSchema, accountRow, listAccounts } from "@/lib/moneyplus";
import { withUndo } from "@/lib/undo-route";
import { cleanSharedLimit, syncCardReminder } from "@/lib/cards";
import { recorded, removed } from "@/lib/undo";

export async function GET() {
  await connection();
  return NextResponse.json({ accounts: await listAccounts() });
}

export const POST = withUndo(async (req: Request) => {
  const p = accountInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  p.data.sharedLimitId = await cleanSharedLimit(null, p.data.sharedLimitId);
  const a = await recorded({ title: `Added account “${p.data.name}”`, kind: "add" }, async (rec) => {
    const [row] = await db()
      .insert(accounts)
      .values(accountRow(p.data))
      .returning();
    rec(removed("accounts", [row.id]));
    // Credit card with bill/due days → monthly "Pay the bill" reminder.
    await syncCardReminder(row.id);
    return row;
  });
  return NextResponse.json({ account: a });
});
