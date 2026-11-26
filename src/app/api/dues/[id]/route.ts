import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, dues } from "@/db";
import { settleDue, unsettleDue } from "@/lib/moneyplus";
import { withUndo } from "@/lib/undo-route";
import { money, recorded, snap } from "@/lib/undo";
import { deleteReminders } from "@/lib/create";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/** Settle: { log: boolean, accountId? } — log=true records the money received/paid. */
export const POST = withUndo(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const { log = true, accountId = null } = (await req.json().catch(() => ({}))) as { log?: boolean; accountId?: string | null };
  const d = await settleDue(id, { log, accountId });
  return d ? NextResponse.json({ due: d }) : NextResponse.json({ error: "Already settled or not found" }, { status: 404 });
});

/** Undo "paid back": { settled: false }. */
export const PATCH = withUndo(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const { settled } = (await req.json().catch(() => ({}))) as { settled?: boolean };
  if (settled !== false) return NextResponse.json({ error: "Bad input" }, { status: 400 });
  const d = await unsettleDue(id);
  return d ? NextResponse.json({ due: d }) : notFound();
});

export const DELETE = withUndo(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const [cur] = await db().select().from(dues).where(eq(dues.id, id));
  if (!cur) return notFound();
  await recorded({ title: `Deleted: ${cur.direction === "they_owe" ? `${cur.person} owes you` : `you owe ${cur.person}`} ${money(cur.amountPaise)}`, kind: "delete" }, async (rec) => {
    rec(await snap("dues", [id]));
    await db().delete(dues).where(eq(dues.id, id));
    // Remove its "Collect ₹… from …" reminder too.
    if (cur.reminderId) await deleteReminders([cur.reminderId]);
  });
  return NextResponse.json({ ok: true });
});
