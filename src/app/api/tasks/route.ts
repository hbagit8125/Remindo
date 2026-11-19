import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { createTasks, focusFrom, listTasks, taskInputSchema } from "@/lib/tasks";

/** Open tasks (+ done in the last week) and today's focus list. */
export async function GET() {
  await connection();
  const all = await listTasks();
  return NextResponse.json({ tasks: all, focus: focusFrom(all) });
}

/** Create: { items: TaskInput[] } */
export async function POST(req: Request) {
  const parsed = z.object({ items: z.array(taskInputSchema).min(1).max(30) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  return NextResponse.json({ created: await createTasks(parsed.data.items) });
}
