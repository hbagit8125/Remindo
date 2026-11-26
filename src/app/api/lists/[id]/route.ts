import { connection, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, lists } from "@/db";
import { getList, listPatchSchema } from "@/lib/life";
import { withUndo } from "@/lib/undo-route";
import { changeRow, recorded, snap, snapWhere } from "@/lib/undo";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  await connection();
  const { id } = await params;
  const l = await getList(id);
  return l ? NextResponse.json({ list: l }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export const PATCH = withUndo(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const p = listPatchSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  const [cur] = await db().select().from(lists).where(eq(lists.id, id));
  if (!cur) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const keys = Object.keys(p.data);
  const title = keys.length === 1 && keys[0] === "pinned" ? `${p.data.pinned ? "Pinned" : "Unpinned"} ${cur.name}` : `Edited ${cur.name}`;
  const [l] = await changeRow("lists", id, title, "edit", () =>
    db()
      .update(lists)
      .set({ ...p.data, updatedAt: new Date() })
      .where(eq(lists.id, id))
      .returning(),
  );
  return NextResponse.json({ list: l });
});

export const DELETE = withUndo(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const [cur] = await db().select().from(lists).where(eq(lists.id, id));
  if (cur)
    await recorded({ title: `Deleted ${cur.kind} ${cur.name}`, kind: "delete" }, async (rec) => {
      rec({ op: "seq", ops: [(await snap("lists", [id]))!, await snapWhere("listItems", "listId", id)] });
      await db().delete(lists).where(eq(lists.id, id));
    });
  return NextResponse.json({ ok: true });
});
