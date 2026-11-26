import { NextResponse } from "next/server";
import { z } from "zod";
import { addPlaceReminders, placeReminderInputSchema } from "@/lib/places";
import { withUndo } from "@/lib/undo-route";

export const POST = withUndo(async (req: Request) => {
  const p = z.object({ items: z.array(placeReminderInputSchema).min(1).max(20) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Say what to remind you and where" }, { status: 400 });
  return NextResponse.json({ reminders: await addPlaceReminders(p.data.items) });
});
