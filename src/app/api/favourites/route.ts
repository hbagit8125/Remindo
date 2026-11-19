import { connection, NextResponse } from "next/server";
import { db, favourites } from "@/db";
import { favouriteInputSchema, listFavourites, suggestFavourites } from "@/lib/moneyplus";

export async function GET() {
  await connection();
  const [favs, suggestions] = await Promise.all([listFavourites(), suggestFavourites()]);
  return NextResponse.json({ favourites: favs, suggestions });
}

export async function POST(req: Request) {
  const p = favouriteInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  const [f] = await db().insert(favourites).values({ label: p.data.label, payload: p.data.payload, sortOrder: Date.now() % 1e9 }).returning();
  return NextResponse.json({ favourite: f });
}
