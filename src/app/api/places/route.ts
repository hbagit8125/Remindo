import { connection, NextResponse } from "next/server";
import { deletePlace, listPlaceReminders, listPlaces, placeInputSchema, savePlace } from "@/lib/places";

/** Saved places + location reminders (one call for the Places screen and the location watcher). */
export async function GET() {
  await connection();
  const [places, reminders] = await Promise.all([listPlaces(), listPlaceReminders()]);
  return NextResponse.json({ places, reminders });
}

export async function POST(req: Request) {
  const p = placeInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Name the place and allow location" }, { status: 400 });
  return NextResponse.json({ place: await savePlace(p.data) });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which place?" }, { status: 400 });
  await deletePlace(id);
  return NextResponse.json({ ok: true });
}
