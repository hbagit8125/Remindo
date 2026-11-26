import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteDocument, documentInputSchema, renewDocument, saveDocument } from "@/lib/life";
import { withUndo } from "@/lib/undo-route";

type Ctx = { params: Promise<{ id: string }> };

/** Mark renewed: { expiryDate, cost? } — moves the reminder and logs the cost. */
export const POST = withUndo(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const p = z
    .object({ expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), cost: z.coerce.number().min(0).max(1e8).nullish() })
    .safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Pick the new expiry date" }, { status: 400 });
  const d = await renewDocument(id, p.data.expiryDate, p.data.cost ?? null);
  return d ? NextResponse.json({ document: d }) : NextResponse.json({ error: "Not found" }, { status: 404 });
});

export const PATCH = withUndo(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const p = documentInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  const d = await saveDocument(p.data, id);
  return d ? NextResponse.json({ document: d }) : NextResponse.json({ error: "Not found" }, { status: 404 });
});

export const DELETE = withUndo(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await deleteDocument(id);
  return NextResponse.json({ ok: true });
});
