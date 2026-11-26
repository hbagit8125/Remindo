import { NextResponse } from "next/server";
import { undoActivity } from "@/lib/undo";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Undo one change. */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const res = await undoActivity(id);
  return NextResponse.json(res, { status: res.ok ? 200 : 409 });
}
