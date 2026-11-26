import { NextResponse } from "next/server";
import { executeCommand, executeSchema } from "@/lib/assistant";
import { withUndo } from "@/lib/undo-route";

/** Run a change you confirmed (from a voice/typed command). */
export const POST = withUndo(async (req: Request) => {
  const p = executeSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  return NextResponse.json({ message: await executeCommand(p.data) });
});
