import { NextResponse } from "next/server";
import { deleteTask, taskPatchSchema, updateTask } from "@/lib/tasks";
import { withUndo } from "@/lib/undo-route";

type Ctx = { params: Promise<{ id: string }> };

/** Partial update: title, notes, dueDate, focus, priority, done. */
export const PATCH = withUndo(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const parsed = taskPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const task = await updateTask(id, parsed.data);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ task });
});

export const DELETE = withUndo(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await deleteTask(id);
  return NextResponse.json({ ok: true });
});
