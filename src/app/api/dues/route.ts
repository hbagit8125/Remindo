import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { createDues, dueInputSchema, listDues } from "@/lib/moneyplus";
import { withUndo } from "@/lib/undo-route";

export async function GET() {
  await connection();
  return NextResponse.json(await listDues());
}

export const POST = withUndo(async (req: Request) => {
  const p = z.object({ items: z.array(dueInputSchema).min(1).max(10) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  return NextResponse.json({ created: await createDues(p.data.items) });
});
