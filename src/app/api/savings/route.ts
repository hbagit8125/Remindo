import { connection, NextResponse } from "next/server";
import { createSaving, listSavings, savingInputSchema } from "@/lib/savings";
import { withUndo } from "@/lib/undo-route";

export async function GET() {
  await connection();
  return NextResponse.json(await listSavings());
}

export const POST = withUndo(async (req: Request) => {
  const p = savingInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  return NextResponse.json({ saving: await createSaving(p.data) });
});
