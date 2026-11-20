import { isoDay } from "./day";
import { and, desc, eq, gte, lte, or } from "drizzle-orm";
import { z } from "zod";
import { db, tasks, type Task } from "@/db";
import { fmtLocal, localDayBounds } from "./time";

const day = isoDay();

/** Editable shape of a task (AI parser, Telegram, the Task form). */
export const taskInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).nullish(),
  dueDate: day.nullish(),
  /** Put it in today's focus list. */
  focus: z.boolean().default(false),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
});
export type TaskInput = z.infer<typeof taskInputSchema>;

export const taskPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().max(2000).nullish(),
  dueDate: day.nullish(),
  focus: z.boolean().optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  done: z.boolean().optional(),
});
export type TaskPatch = z.infer<typeof taskPatchSchema>;

export const todayStr = (now = new Date()) => fmtLocal(now, "yyyy-MM-dd");

export async function createTasks(items: TaskInput[], now = new Date()) {
  if (!items.length) return [];
  return db()
    .insert(tasks)
    .values(
      items.map((i) => ({
        title: i.title,
        notes: i.notes || null,
        dueDate: i.dueDate || null,
        focusDate: i.focus ? todayStr(now) : null,
        priority: i.priority,
      })),
    )
    .returning();
}

export async function updateTask(id: string, p: TaskPatch, now = new Date()) {
  const set: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
  if (p.title !== undefined) set.title = p.title;
  if (p.notes !== undefined) set.notes = p.notes || null;
  if (p.dueDate !== undefined) set.dueDate = p.dueDate || null;
  if (p.priority !== undefined) set.priority = p.priority;
  if (p.focus !== undefined) set.focusDate = p.focus ? todayStr(now) : null;
  if (p.done !== undefined) {
    set.done = p.done;
    set.doneAt = p.done ? new Date() : null;
  }
  const [row] = await db().update(tasks).set(set).where(eq(tasks.id, id)).returning();
  return row ?? null;
}

/** Open tasks, plus ones finished in the last 7 days. */
export async function listTasks(now = new Date()) {
  const since = new Date(now.getTime() - 7 * 86400000);
  return db()
    .select()
    .from(tasks)
    .where(or(eq(tasks.done, false), gte(tasks.doneAt, since)))
    .orderBy(desc(tasks.createdAt));
}

export type FocusItem = Task & { carried: boolean; overdue: boolean };

/**
 * Today's focus: starred tasks (unfinished stars from earlier days carry over),
 * anything due today or overdue, and tasks already finished today.
 */
export function focusFrom(all: Task[], now = new Date()): FocusItem[] {
  const today = todayStr(now);
  const { start } = localDayBounds(now);
  return all
    .filter((t) => {
      if (t.done) return Boolean(t.doneAt && t.doneAt >= start && (t.focusDate || (t.dueDate && t.dueDate <= today)));
      return Boolean((t.focusDate && t.focusDate <= today) || (t.dueDate && t.dueDate <= today));
    })
    .map((t) => ({
      ...t,
      carried: !t.done && Boolean(t.focusDate && t.focusDate < today),
      overdue: !t.done && Boolean(t.dueDate && t.dueDate < today),
    }))
    .sort((a, b) => Number(a.done) - Number(b.done) || rank(b.priority) - rank(a.priority) || (a.dueDate || "9").localeCompare(b.dueDate || "9"));
}

const rank = (p: string) => (p === "high" ? 2 : p === "normal" ? 1 : 0);

/** For the evening email: finished today, and focus/overdue still open. */
export async function taskDaySummary(now = new Date()) {
  const { start } = localDayBounds(now);
  const all = await listTasks(now);
  const doneToday = all.filter((t) => t.done && t.doneAt && t.doneAt >= start);
  const pending = focusFrom(all, now).filter((t) => !t.done);
  return { doneToday, pending };
}

/** Tasks with a due date in [from, to] (YYYY-MM-DD), for the calendar. */
export async function tasksDueBetween(from: string, to: string) {
  return db().select().from(tasks).where(and(gte(tasks.dueDate, from), lte(tasks.dueDate, to)));
}
