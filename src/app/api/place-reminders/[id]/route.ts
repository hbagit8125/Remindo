import { NextResponse } from "next/server";
import { z } from "zod";
import { deletePlaceReminder, firePlaceReminder, updatePlaceReminder } from "@/lib/places";

type Ctx = { params: Promise<{ id: string }> };

/** The phone saw you arrive/leave. */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await firePlaceReminder(id);
  return r ? NextResponse.json({ reminder: r }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = z
    .object({ active: z.boolean().optional(), text: z.string().trim().min(1).max(200).optional(), repeat: z.boolean().optional(), on: z.enum(["arrive", "leave"]).optional(), place: z.string().trim().min(1).max(40).optional() })
    .safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Bad input" }, { status: 400 });
  await updatePlaceReminder(id, p.data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await deletePlaceReminder(id);
  return NextResponse.json({ ok: true });
}
