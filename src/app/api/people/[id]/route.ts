import { NextResponse } from "next/server";
import { deletePerson, personInputSchema, savePerson } from "@/lib/life";
import { withUndo } from "@/lib/undo-route";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withUndo(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const p = personInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  const r = await savePerson(p.data, id);
  return r ? NextResponse.json({ person: r }) : NextResponse.json({ error: "Not found" }, { status: 404 });
});

export const DELETE = withUndo(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await deletePerson(id);
  return NextResponse.json({ ok: true });
});
