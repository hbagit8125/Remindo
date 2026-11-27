import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { and, desc, eq, getTableColumns, inArray, isNull, lt, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import * as T from "@/db";
import { db } from "@/db";
import type { Via } from "./scheduler";

/**
 * Undo, everywhere.
 *
 * Every change you make (in the app, from Telegram, an email button, a phone notification or the AI)
 * is written to the `activity` table together with the steps that put it back. Undo replays those
 * steps backwards. Wrap a change in `recorded()`; it can call other recorded helpers inside and
 * they all become one entry ("Settled up with Arun" holds each due, refund entry and reminder).
 */

// ------------------------------------------------------------- tables we can put back

const TABLES = {
  reminders: T.reminders,
  completions: T.completions,
  tasks: T.tasks,
  transactions: T.transactions,
  accounts: T.accounts,
  budgets: T.budgets,
  favourites: T.favourites,
  dues: T.dues,
  splits: T.splits,
  splitGroups: T.splitGroups,
  goals: T.goals,
  goalContributions: T.goalContributions,
  documents: T.documents,
  people: T.people,
  medicines: T.medicines,
  lists: T.lists,
  listItems: T.listItems,
  settings: T.settings,
} satisfies Record<string, PgTable>;
export type TableName = keyof typeof TABLES;

type Row = Record<string, unknown>;

export type Op =
  /** Put these rows back exactly as they were (insert, or overwrite if they still exist). */
  | { op: "restore"; t: TableName; rows: Row[] }
  /** These rows were created: delete them. */
  | { op: "remove"; t: TableName; ids: string[] }
  /** Make every row where col = val look like it did (delete the current ones, put the old ones back). */
  | { op: "replace"; t: TableName; col: string; val: string; rows: Row[] }
  /** Make the whole table look like it did (small tables like budgets). */
  | { op: "replaceAll"; t: TableName; rows: Row[] }
  /** Run these steps in this order (e.g. a reminder before its completions). */
  | { op: "seq"; ops: Op[] }
  | { op: "uncomplete"; reminderId: string; occurrenceAt: string }
  | { op: "unsnooze"; reminderId: string; occurrenceAt: string; deliveryId: string }
  | { op: "unsettle"; dueId: string };

// ------------------------------------------------------------- recording

type Ctx = { id: string; via: Via; ops: Op[]; owner: symbol | null; title: string | null; kind: string; ref: string | null };
const als = new AsyncLocalStorage<Ctx>();

/** The id the current change will be saved under (used for Telegram "Undo" buttons). */
export function currentActivityId() {
  return als.getStore()?.id ?? null;
}

/**
 * Run `fn` and save whatever it changed as one undoable entry.
 * Returns the entry's id (null if nothing was changed) so the caller can offer "Undo".
 */
export async function track<V>(fn: () => Promise<V>, opts: { via?: Via } = {}): Promise<{ value: V; undoId: string | null }> {
  const outer = als.getStore();
  if (outer) return { value: await fn(), undoId: outer.id };
  const ctx: Ctx = { id: randomUUID(), via: opts.via ?? "app", ops: [], owner: null, title: null, kind: "other", ref: null };
  const value = await als.run(ctx, fn);
  return { value, undoId: await save(ctx) };
}

/**
 * A change that can be undone. `rec(op)` records how to put it back.
 * The outermost recorded() names the entry; inner ones just add their steps.
 */
export async function recorded<V>(
  // (Callbacks take `any`: TypeScript can't infer V from `fn` when it also has to type these.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: { title: string | null | ((v: any) => string | null); kind: string; ref?: string | ((v: any) => string | null) },
  fn: (rec: (op: Op | Op[] | null | undefined | false) => void) => Promise<V>,
): Promise<V> {
  const ctx = als.getStore();
  if (!ctx) return (await track(() => recorded(meta, fn))).value;
  const me = Symbol();
  if (!ctx.owner) {
    ctx.owner = me;
    ctx.kind = meta.kind;
  }
  const value = await fn((op) => {
    if (op) ctx.ops.push(...(Array.isArray(op) ? op : [op]));
  });
  if (ctx.owner === me) {
    ctx.title = typeof meta.title === "function" ? meta.title(value) : meta.title;
    ctx.ref = (typeof meta.ref === "function" ? meta.ref(value) : meta.ref) ?? null;
  }
  return value;
}

async function save(ctx: Ctx) {
  if (!ctx.ops.length || !ctx.title) return null;
  try {
    await db().insert(T.activity).values({ id: ctx.id, title: ctx.title.slice(0, 200), kind: ctx.kind, via: ctx.via, ops: ctx.ops, ref: ctx.ref });
    return ctx.id;
  } catch (e) {
    // Never let the history break the action itself (e.g. before the migration has run).
    console.error("[remindo:undo] couldn't save activity", e);
    return null;
  }
}

/** Something was undone another way (e.g. un-ticking a reminder): mark its entry as undone too. */
export async function markUndone(ref: string) {
  await db()
    .update(T.activity)
    .set({ undoneAt: new Date() })
    .where(and(eq(T.activity.ref, ref), isNull(T.activity.undoneAt)))
    .catch(() => null);
}

// ------------------------------------------------------------- snapshots

const toJson = (rows: unknown[]) => JSON.parse(JSON.stringify(rows)) as Row[];

/** "Put these rows back as they are now." */
export async function snap(t: TableName, ids: (string | null | undefined)[]): Promise<Op | null> {
  const list = [...new Set(ids.filter(Boolean) as string[])];
  if (!list.length) return null;
  const table = TABLES[t];
  const pk = pkOf(table);
  const rows = await db()
    .select()
    .from(table)
    .where(inArray(pk.col, list) as SQL);
  return rows.length ? { op: "restore", t, rows: toJson(rows) } : null;
}

/** "Make every row where col = val look like it does now." */
export async function snapWhere(t: TableName, col: string, val: string): Promise<Op> {
  const table = TABLES[t];
  const c = (getTableColumns(table) as Record<string, AnyPgColumn>)[col];
  const rows = await db()
    .select()
    .from(table)
    .where(eq(c as never, val));
  return { op: "replace", t, col, val, rows: toJson(rows) };
}

/** A reminder with its done history and linked payments (deleting it would lose those). */
export async function snapReminder(id: string | null | undefined): Promise<Op | null> {
  if (!id) return null;
  const r = await snap("reminders", [id]);
  if (!r) return null;
  const ops: Op[] = [r, await snapWhere("completions", "reminderId", id)];
  const tx = await db().select({ id: T.transactions.id }).from(T.transactions).where(eq(T.transactions.reminderId, id));
  const txOp = await snap(
    "transactions",
    tx.map((x) => x.id),
  );
  if (txOp) ops.push(txOp);
  return { op: "seq", ops };
}

export async function snapAll(t: TableName): Promise<Op> {
  return { op: "replaceAll", t, rows: toJson(await db().select().from(TABLES[t])) };
}

export async function snapSetting(key: string): Promise<Op> {
  const rows = await db().select().from(T.settings).where(eq(T.settings.key, key));
  return { op: "replace", t: "settings", col: "key", val: key, rows: toJson(rows) };
}

export const removed = (t: TableName, ids: (string | null | undefined)[]): Op | null => {
  const list = ids.filter(Boolean) as string[];
  return list.length ? { op: "remove", t, ids: list } : null;
};

// ------------------------------------------------------------- undo

function pkOf(table: PgTable) {
  const cols = getTableColumns(table) as Record<string, AnyPgColumn>;
  const entry = Object.entries(cols).find(([, c]) => c.primary) ?? ["id", cols.id];
  return { key: entry[0], col: entry[1] };
}

/** JSON turned dates into strings: turn them back. */
function revive(table: PgTable, row: Row) {
  const cols = getTableColumns(table) as Record<string, AnyPgColumn>;
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (!(k in cols)) continue;
    out[k] = cols[k].dataType === "date" && typeof v === "string" ? new Date(v) : v;
  }
  return out;
}

async function restoreRows(t: TableName, rows: Row[], touched: Set<string>) {
  const table = TABLES[t];
  const pk = pkOf(table);
  for (const raw of rows) {
    const row = revive(table, raw);
    if (t === "reminders") {
      // Bump the version so fresh alerts are planned for the restored reminder.
      const { cancelQueued } = await import("./scheduler");
      const [cur] = await db().select({ v: T.reminders.version }).from(T.reminders).where(eq(T.reminders.id, row.id as string));
      row.version = Math.max(Number(row.version) || 1, cur?.v || 0) + 1;
      if (cur) await cancelQueued(row.id as string);
      touched.add(row.id as string);
    }
    const { [pk.key]: _pk, ...rest } = row;
    void _pk;
    await db()
      .insert(table)
      .values(row as never)
      .onConflictDoUpdate({ target: pk.col as never, set: rest as never });
  }
}

async function apply(op: Op, touched: Set<string>) {
  switch (op.op) {
    case "seq":
      for (const o of op.ops) await apply(o, touched);
      return;
    case "restore":
      return restoreRows(op.t, op.rows, touched);
    case "remove": {
      const table = TABLES[op.t];
      if (op.t === "reminders") {
        const { cancelQueued } = await import("./scheduler");
        for (const id of op.ids) await cancelQueued(id);
      }
      await db()
        .delete(table)
        .where(inArray(pkOf(table).col, op.ids) as SQL);
      return;
    }
    case "replace": {
      const table = TABLES[op.t];
      const c = (getTableColumns(table) as Record<string, AnyPgColumn>)[op.col];
      await db()
        .delete(table)
        .where(eq(c as never, op.val));
      return restoreRows(op.t, op.rows, touched);
    }
    case "replaceAll": {
      await db().delete(TABLES[op.t]);
      return restoreRows(op.t, op.rows, touched);
    }
    case "uncomplete": {
      const { uncompleteOccurrence } = await import("./scheduler");
      await uncompleteOccurrence(op.reminderId, new Date(op.occurrenceAt));
      touched.add(op.reminderId);
      return;
    }
    case "unsnooze": {
      await db().update(T.deliveries).set({ status: "cancelled" }).where(and(eq(T.deliveries.id, op.deliveryId), eq(T.deliveries.status, "queued")));
      const [r] = await db().select().from(T.reminders).where(eq(T.reminders.id, op.reminderId));
      if (r) await import("./sync").then((m) => m.syncOccurrence(r, new Date(op.occurrenceAt), { state: "undone", via: "app" })).catch(() => null);
      touched.add(op.reminderId);
      return;
    }
    case "unsettle": {
      const { unsettleDue } = await import("./moneyplus");
      const d = await unsettleDue(op.dueId);
      if (d?.reminderId) touched.add(d.reminderId);
      return;
    }
  }
}

export const UNDO_DAYS = 30;

export type UndoResult = { ok: boolean; title: string; message: string };

/** Put things back the way they were before this entry. */
export async function undoActivity(id: string, now = new Date()): Promise<UndoResult> {
  const [a] = await db().select().from(T.activity).where(eq(T.activity.id, id));
  if (!a) return { ok: false, title: "Nothing to undo", message: "That change is no longer in your history." };
  if (a.undoneAt) return { ok: true, title: "Already undone", message: `“${a.title}” was already undone.` };
  if (now.getTime() - a.createdAt.getTime() > UNDO_DAYS * 864e5) return { ok: false, title: "Too old", message: `Changes can be undone for ${UNDO_DAYS} days.` };
  // Claim it first so a double tap can't undo twice.
  const [claimed] = await db()
    .update(T.activity)
    .set({ undoneAt: now })
    .where(and(eq(T.activity.id, id), isNull(T.activity.undoneAt)))
    .returning();
  if (!claimed) return { ok: true, title: "Already undone", message: `“${a.title}” was already undone.` };
  const touched = new Set<string>();
  try {
    for (const op of [...(a.ops as Op[])].reverse()) await apply(op, touched);
  } catch (e) {
    await db().update(T.activity).set({ undoneAt: null }).where(eq(T.activity.id, id));
    console.error("[remindo:undo] failed", e);
    return { ok: false, title: "Couldn't undo", message: "Something changed since then, so it can't be put back automatically." };
  }
  // Card bills depend on entries: bring their amounts back in step.
  await import("./cards").then((m) => m.syncAllCards()).catch(() => null);
  if (touched.size) {
    const { planAndQueue } = await import("./scheduler");
    const live = await db().select({ id: T.reminders.id }).from(T.reminders).where(inArray(T.reminders.id, [...touched]));
    if (live.length) await planAndQueue({ reminderIds: live.map((r) => r.id), now });
  }
  return { ok: true, title: "Undone", message: `“${a.title}” was undone.` };
}

/** Latest changes, newest first. */
export async function listActivity(limit = 100) {
  return db()
    .select({ id: T.activity.id, title: T.activity.title, kind: T.activity.kind, via: T.activity.via, createdAt: T.activity.createdAt, undoneAt: T.activity.undoneAt })
    .from(T.activity)
    .orderBy(desc(T.activity.createdAt))
    .limit(limit);
}

/** Daily clean-up. */
export async function pruneActivity(now = new Date()) {
  await db()
    .delete(T.activity)
    .where(lt(T.activity.createdAt, new Date(now.getTime() - UNDO_DAYS * 864e5)))
    .catch(() => null);
}

// ------------------------------------------------------------- small helpers for common changes

const MONEY = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const money = MONEY;

/** "Added “Pay rent”" / "Added 3 reminders" */
export function addedTitle(noun: string, names: string[]) {
  return names.length === 1 ? `Added ${noun} “${names[0]}”` : `Added ${names.length} ${noun}s`;
}

/** Edit or delete one row: snapshot it first, then run the change. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function changeRow<V>(t: TableName, id: string, title: string | ((v: any) => string | null), kind: string, fn: () => Promise<V>) {
  return recorded<V>({ title, kind }, async (rec) => {
    rec(await snap(t, [id]));
    return fn();
  });
}
