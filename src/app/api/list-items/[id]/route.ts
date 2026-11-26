import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, listItems } from "@/db";
import { withUndo } from "@/lib/undo-route";
import { changeRow } from "@/lib/undo";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withUndo(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const p = z.object({ done: z.boolean().optional(), text: z.string().trim().min(1).max(200).optional() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Bad input" }, { status: 400 });
  const [cur] = await db().select().from(listItems).where(eq(listItems.id, id));
  if (!cur) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const title = p.data.done === true && !cur.done ? `Ticked “${cur.text}”` : p.data.done === false && cur.done ? `Unticked “${cur.text}”` : `Edited “${cur.text}”`;
  const [it] = await changeRow("listItems", id, title, "tick", () => db().update(listItems).set(p.data).where(eq(listItems.id, id)).returning());
  return NextResponse.json({ item: it });
});

export const DELETE = withUndo(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const [cur] = await db().select().from(listItems).where(eq(listItems.id, id));
  if (cur) await changeRow("listItems", id, `Removed “${cur.text}” from a list`, "delete", () => db().delete(listItems).where(eq(listItems.id, id)));
  return NextResponse.json({ ok: true });
});
