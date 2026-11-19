import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, listItems, lists } from "@/db";

type Ctx = { params: Promise<{ id: string }> };

/** Add items: { items: string[] }. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = z.object({ items: z.array(z.string().trim().min(1).max(200)).min(1).max(50) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Type something to add" }, { status: 400 });
  const base = Date.now() % 1e9;
  const rows = await db()
    .insert(listItems)
    .values(p.data.items.map((text, i) => ({ listId: id, text, sortOrder: base + i })))
    .returning();
  await db().update(lists).set({ updatedAt: new Date() }).where(eq(lists.id, id));
  return NextResponse.json({ items: rows });
}

/** Clear ticked items. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await db().delete(listItems).where(and(eq(listItems.listId, id), eq(listItems.done, true)));
  return NextResponse.json({ ok: true });
}
