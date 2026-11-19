import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, tasks } from "@/db";
import { taskPatchSchema, updateTask } from "@/lib/tasks";

type Ctx = { params: Promise<{ id: string }> };

/** Partial update: title, notes, dueDate, focus, priority, done. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = taskPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const task = await updateTask(id, parsed.data);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ task });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await db().delete(tasks).where(eq(tasks.id, id));
  return NextResponse.json({ ok: true });
}
