import { NextResponse } from "next/server";
import { deleteEntry, unlinkEntry } from "@/lib/savings";
import { withUndo } from "@/lib/undo-route";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = withUndo(async (_req: Request, { params }: Ctx) => {
  await deleteEntry((await params).id);
  return NextResponse.json({ ok: true });
});

/** { unlink: true } → keep the entry, remove the bank transfer it made. */
export const PATCH = withUndo(async (req: Request, { params }: Ctx) => {
  const b = (await req.json().catch(() => null)) as { unlink?: boolean } | null;
  if (!b?.unlink) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  return NextResponse.json({ entry: await unlinkEntry((await params).id) });
});
