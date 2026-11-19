import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, favourites } from "@/db";
import { logFavourite } from "@/lib/moneyplus";

type Ctx = { params: Promise<{ id: string }> };

/** One tap: log this favourite as today's entry. */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const tx = await logFavourite(id);
  return tx ? NextResponse.json({ transaction: tx }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await db().delete(favourites).where(eq(favourites.id, id));
  return NextResponse.json({ ok: true });
}
