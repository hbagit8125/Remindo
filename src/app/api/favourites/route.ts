import { connection, NextResponse } from "next/server";
import { db, favourites } from "@/db";
import { favouriteInputSchema, listFavourites, suggestFavourites } from "@/lib/moneyplus";
import { withUndo } from "@/lib/undo-route";
import { recorded, removed } from "@/lib/undo";

export async function GET() {
  await connection();
  const [favs, suggestions] = await Promise.all([listFavourites(), suggestFavourites()]);
  return NextResponse.json({ favourites: favs, suggestions });
}

export const POST = withUndo(async (req: Request) => {
  const p = favouriteInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  const f = await recorded({ title: `Added favourite “${p.data.label}”`, kind: "add" }, async (rec) => {
    const [row] = await db().insert(favourites).values({ label: p.data.label, payload: p.data.payload, sortOrder: Date.now() % 1e9 }).returning();
    rec(removed("favourites", [row.id]));
    return row;
  });
  return NextResponse.json({ favourite: f });
});
