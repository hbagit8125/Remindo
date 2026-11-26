import { connection, NextResponse } from "next/server";
import { db, accounts } from "@/db";
import { accountInputSchema, listAccounts } from "@/lib/moneyplus";
import { toPaise } from "@/lib/money";
import { withUndo } from "@/lib/undo-route";
import { recorded, removed } from "@/lib/undo";

export async function GET() {
  await connection();
  return NextResponse.json({ accounts: await listAccounts() });
}

export const POST = withUndo(async (req: Request) => {
  const p = accountInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  const a = await recorded({ title: `Added account “${p.data.name}”`, kind: "add" }, async (rec) => {
    const [row] = await db()
      .insert(accounts)
      .values({ name: p.data.name, kind: p.data.kind, openingBalancePaise: toPaise(p.data.openingBalance) })
      .returning();
    rec(removed("accounts", [row.id]));
    return row;
  });
  return NextResponse.json({ account: a });
});
