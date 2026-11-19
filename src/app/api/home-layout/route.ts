import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { getSetting, setSetting } from "@/lib/settings";

const schema = z.object({ widgets: z.array(z.object({ id: z.string().max(30), hidden: z.boolean() })).max(30) });

/** Which Home widgets to show, and in what order. */
export async function GET() {
  await connection();
  return NextResponse.json({ widgets: (await getSetting<{ id: string; hidden: boolean }[]>("homeWidgets")) || null });
}

export async function PUT(req: Request) {
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Bad layout" }, { status: 400 });
  await setSetting("homeWidgets", p.data.widgets);
  return NextResponse.json({ widgets: p.data.widgets });
}
