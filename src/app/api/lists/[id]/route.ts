import { connection, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, lists } from "@/db";
import { getList, listPatchSchema } from "@/lib/life";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  await connection();
  const { id } = await params;
  const l = await getList(id);
  return l ? NextResponse.json({ list: l }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = listPatchSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  const [l] = await db()
    .update(lists)
    .set({ ...p.data, updatedAt: new Date() })
    .where(eq(lists.id, id))
    .returning();
  return NextResponse.json({ list: l });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await db().delete(lists).where(eq(lists.id, id));
  return NextResponse.json({ ok: true });
}
