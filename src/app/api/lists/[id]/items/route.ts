import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, listItems, lists } from "@/db";
import { withUndo } from "@/lib/undo-route";
import { recorded, removed, snap } from "@/lib/undo";

type Ctx = { params: Promise<{ id: string }> };

/** Add items: { items: string[] }. */
export const POST = withUndo(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const p = z.object({ items: z.array(z.string().trim().min(1).max(200)).min(1).max(50) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Type something to add" }, { status: 400 });
  const base = Date.now() % 1e9;
  const rows = await recorded({ title: p.data.items.length === 1 ? `Added “${p.data.items[0]}” to a list` : `Added ${p.data.items.length} items to a list`, kind: "add" }, async (rec) => {
    const r = await db()
      .insert(listItems)
      .values(p.data.items.map((text, i) => ({ listId: id, text, sortOrder: base + i })))
      .returning();
    rec(removed("listItems", r.map((x) => x.id)));
    return r;
  });
  await db().update(lists).set({ updatedAt: new Date() }).where(eq(lists.id, id));
  return NextResponse.json({ items: rows });
});

/** Clear ticked items. */
export const DELETE = withUndo(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const ticked = await db().select().from(listItems).where(and(eq(listItems.listId, id), eq(listItems.done, true)));
  if (ticked.length)
    await recorded({ title: `Cleared ${ticked.length} ticked item${ticked.length === 1 ? "" : "s"}`, kind: "delete" }, async (rec) => {
      rec(await snap("listItems", ticked.map((t) => t.id)));
      await db().delete(listItems).where(and(eq(listItems.listId, id), eq(listItems.done, true)));
    });
  return NextResponse.json({ ok: true });
});
