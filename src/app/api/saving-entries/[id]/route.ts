import { NextResponse } from "next/server";
import { deleteEntry } from "@/lib/savings";
import { withUndo } from "@/lib/undo-route";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = withUndo(async (_req: Request, { params }: Ctx) => {
  await deleteEntry((await params).id);
  return NextResponse.json({ ok: true });
});
