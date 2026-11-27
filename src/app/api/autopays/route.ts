import { connection, NextResponse } from "next/server";
import { autopayInputSchema, createAutopay, listAutopays } from "@/lib/autopay";
import { withUndo } from "@/lib/undo-route";

export async function GET() {
  await connection();
  return NextResponse.json({ autopays: await listAutopays().catch(() => []) });
}

export const POST = withUndo(async (req: Request) => {
  const p = autopayInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  return NextResponse.json({ autopay: await createAutopay(p.data) });
});
