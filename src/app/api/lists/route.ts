import { connection, NextResponse } from "next/server";
import { db, lists } from "@/db";
import { allLists, listInputSchema } from "@/lib/life";
import { withUndo } from "@/lib/undo-route";
import { recorded, removed } from "@/lib/undo";

export async function GET() {
  await connection();
  return NextResponse.json({ lists: await allLists() });
}

export const POST = withUndo(async (req: Request) => {
  const p = listInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  const l = await recorded({ title: `Added ${p.data.kind} ${p.data.name}`, kind: "add" }, async (rec) => {
    const [row] = await db()
      .insert(lists)
      .values({ name: p.data.name, emoji: p.data.emoji || null, kind: p.data.kind, body: p.data.body || null, pinned: !!p.data.pinned })
      .returning();
    rec(removed("lists", [row.id]));
    return row;
  });
  return NextResponse.json({ list: l });
});
