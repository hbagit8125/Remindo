import { NextResponse } from "next/server";
import { autopayInputSchema, deleteAutopay, updateAutopay } from "@/lib/autopay";
import { withUndo } from "@/lib/undo-route";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withUndo(async (req: Request, { params }: Ctx) => {
  const p = autopayInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  const a = await updateAutopay((await params).id, p.data);
  return a ? NextResponse.json({ autopay: a }) : NextResponse.json({ error: "Not found" }, { status: 404 });
});

export const DELETE = withUndo(async (_req: Request, { params }: Ctx) => {
  await deleteAutopay((await params).id);
  return NextResponse.json({ ok: true });
});
