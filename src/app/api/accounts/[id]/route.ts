import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, accounts } from "@/db";
import { accountInputSchema } from "@/lib/moneyplus";
import { toPaise } from "@/lib/money";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = accountInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  const [a] = await db()
    .update(accounts)
    .set({ name: p.data.name, kind: p.data.kind, openingBalancePaise: toPaise(p.data.openingBalance) })
    .where(eq(accounts.id, id))
    .returning();
  return a ? NextResponse.json({ account: a }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

/** Archive (entries keep their history). */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await db().update(accounts).set({ archived: true }).where(eq(accounts.id, id));
  return NextResponse.json({ ok: true });
}
