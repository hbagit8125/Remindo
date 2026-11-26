import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteMedicine, medicineInputSchema, refillMedicine, saveMedicine } from "@/lib/life";
import { withUndo } from "@/lib/undo-route";

type Ctx = { params: Promise<{ id: string }> };

/** Refilled: { added } tablets. */
export const POST = withUndo(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const p = z.object({ added: z.coerce.number().int().min(1).max(10000) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "How many did you buy?" }, { status: 400 });
  return NextResponse.json({ medicine: await refillMedicine(id, p.data.added) });
});

export const PATCH = withUndo(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const p = medicineInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  const m = await saveMedicine(p.data, id);
  return m ? NextResponse.json({ medicine: m }) : NextResponse.json({ error: "Not found" }, { status: 404 });
});

export const DELETE = withUndo(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await deleteMedicine(id);
  return NextResponse.json({ ok: true });
});
