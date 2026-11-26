import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, favourites } from "@/db";
import { logFavourite } from "@/lib/moneyplus";
import { withUndo } from "@/lib/undo-route";
import { changeRow } from "@/lib/undo";

type Ctx = { params: Promise<{ id: string }> };

/** One tap: log this favourite as today's entry. */
export const POST = withUndo(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const tx = await logFavourite(id);
  return tx ? NextResponse.json({ transaction: tx }) : NextResponse.json({ error: "Not found" }, { status: 404 });
});

export const DELETE = withUndo(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const [cur] = await db().select().from(favourites).where(eq(favourites.id, id));
  if (cur) await changeRow("favourites", id, `Removed favourite “${cur.label}”`, "delete", () => db().delete(favourites).where(eq(favourites.id, id)));
  return NextResponse.json({ ok: true });
});
