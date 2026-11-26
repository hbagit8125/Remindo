import { NextResponse } from "next/server";
import { z } from "zod";
import { addToList } from "@/lib/life";
import { withUndo } from "@/lib/undo-route";

/** Add items to a list by name ("shopping"); the list is created if needed. */
export const POST = withUndo(async (req: Request) => {
  const p = z
    .object({ list: z.string().trim().min(1).max(60), items: z.array(z.string()).max(50) })
    .safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Name the list" }, { status: 400 });
  const items = p.data.items.map((x) => x.trim().slice(0, 200)).filter(Boolean);
  if (!items.length) return NextResponse.json({ error: "Add at least one item" }, { status: 400 });
  return NextResponse.json(await addToList(p.data.list, items));
});
