import { NextResponse } from "next/server";
import { deleteGroup, groupInputSchema, saveGroup } from "@/lib/splits";
import { withUndo } from "@/lib/undo-route";

export const POST = withUndo(async (req: Request) => {
  const body = await req.json().catch(() => null);
  const p = groupInputSchema.safeParse(body);
  if (!p.success) return NextResponse.json({ error: "Name the group and add people" }, { status: 400 });
  return NextResponse.json({ group: await saveGroup(p.data, typeof body?.id === "string" ? body.id : undefined) });
});

export const DELETE = withUndo(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which group?" }, { status: 400 });
  await deleteGroup(id);
  return NextResponse.json({ ok: true });
});
