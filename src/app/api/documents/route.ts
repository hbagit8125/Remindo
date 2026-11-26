import { connection, NextResponse } from "next/server";
import { documentInputSchema, listDocuments, saveDocument } from "@/lib/life";
import { withUndo } from "@/lib/undo-route";

export async function GET() {
  await connection();
  return NextResponse.json({ documents: await listDocuments() });
}

export const POST = withUndo(async (req: Request) => {
  const p = documentInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  return NextResponse.json({ document: await saveDocument(p.data) });
});
