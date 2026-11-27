import { connection, NextResponse } from "next/server";
import { addEntry, deleteSaving, entryInputSchema, getSaving, savingInputSchema, updateSaving } from "@/lib/savings";
import { withUndo } from "@/lib/undo-route";

type Ctx = { params: Promise<{ id: string }> };
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  await connection();
  const s = await getSaving((await params).id);
  return s ? NextResponse.json({ saving: s }) : notFound();
}

export const PATCH = withUndo(async (req: Request, { params }: Ctx) => {
  const p = savingInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  const s = await updateSaving((await params).id, p.data);
  return s ? NextResponse.json({ saving: s }) : notFound();
});

/** Add money / take out / interest or profit / update value. */
export const POST = withUndo(async (req: Request, { params }: Ctx) => {
  const p = entryInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  try {
    const e = await addEntry((await params).id, p.data);
    return NextResponse.json({ entry: e });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});

export const DELETE = withUndo(async (_req: Request, { params }: Ctx) => {
  await deleteSaving((await params).id);
  return NextResponse.json({ ok: true });
});
