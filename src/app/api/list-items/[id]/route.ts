import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, listItems } from "@/db";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = z.object({ done: z.boolean().optional(), text: z.string().trim().min(1).max(200).optional() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Bad input" }, { status: 400 });
  const [it] = await db().update(listItems).set(p.data).where(eq(listItems.id, id)).returning();
  return NextResponse.json({ item: it });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await db().delete(listItems).where(eq(listItems.id, id));
  return NextResponse.json({ ok: true });
}
