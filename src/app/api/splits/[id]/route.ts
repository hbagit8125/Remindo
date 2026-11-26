import { connection, NextResponse } from "next/server";
import { deleteSplit, friendly, getSplit, updateSplit } from "@/lib/splits";
import { withUndo } from "@/lib/undo-route";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  await connection();
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const s = await getSplit(id);
  return s ? NextResponse.json({ split: s }) : notFound();
}

export const PATCH = withUndo(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  try {
    const s = await updateSplit(id, await req.json());
    return s ? NextResponse.json({ split: s }) : notFound();
  } catch (e) {
    return NextResponse.json({ error: friendly(e) }, { status: 400 });
  }
});

/** ?expense=1 also deletes the bill's expense (otherwise only the split goes). */
export const DELETE = withUndo(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const ok = await deleteSplit(id, { deleteExpense: new URL(req.url).searchParams.get("expense") === "1" });
  return ok ? NextResponse.json({ ok: true }) : notFound();
});
