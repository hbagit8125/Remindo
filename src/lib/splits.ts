import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, dues, reminders, splitGroups, splits, transactions, type Due, type Split } from "@/db";
import { isoDay } from "./day";
import { createReminders, createTransactions } from "./create";
import { cancelQueued } from "./scheduler";
import { formatINR, toPaise } from "./money";
import { fmtLocal } from "./time";

/**
 * Split bills.
 * - You paid: the full bill is your expense; everyone else's share is a due ("they owe you").
 *   Ticking someone off logs their payback as income (Refund) and adds it to your account.
 * - A friend paid: your share is your expense on the bill date, and you owe the payer.
 *   Ticking it off marks it paid (no second expense).
 * Everyone's share lives on the split (for display); other people's shares are dues, so
 * balances, "who owes me", reminders and "X paid me back" keep working.
 */

import { computeShares, ME, METHODS } from "./split-math";
export { computeShares, ME, METHODS };
export type { Method } from "./split-math";

const person = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform((p) => (/^(me|you|i|myself)$/i.test(p) ? ME : p.replace(/^\w/, (c) => c.toUpperCase())));

export const splitInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  amount: z.coerce.number().positive().max(100_000_000),
  category: z.string().trim().max(40).default("Other"),
  date: isoDay(),
  paidBy: person.default(ME),
  method: z.enum(METHODS).default("equal"),
  /** People in the split (include "me" if you're part of it) and, for non-equal methods, their value. */
  people: z.array(z.object({ person, value: z.coerce.number().min(0).max(100_000_000).default(0) })).min(2).max(30),
  accountId: z.string().uuid().nullish(),
  /** Split an expense you already logged (no new expense is created). */
  transactionId: z.string().uuid().nullish(),
});
export type SplitInput = z.input<typeof splitInputSchema>;
type SplitData = z.output<typeof splitInputSchema>;

function validate(d: SplitData) {
  const total = toPaise(d.amount);
  const computed = computeShares(total, d.method, d.people);
  const mine = computed.find((s) => s.person === ME)?.sharePaise || 0;
  if (d.paidBy !== ME && !computed.some((s) => s.person.toLowerCase() === d.paidBy.toLowerCase())) {
    // The payer is part of the split even if not ticked.
    throw new Error(`${d.paidBy} paid, so add them to the split`);
  }
  if (d.paidBy !== ME && !mine) throw new Error("You're not in this split, so there's nothing for you to track");
  return { total, computed, mine };
}

const others = (computed: { person: string; sharePaise: number }[]) => computed.filter((s) => s.person !== ME && s.sharePaise > 0);

/** One follow-up reminder per split, 3 days later at 7pm. */
async function followUp(title: string, paidBy: string, owed: { person: string; sharePaise: number }[], mine: number, now: Date) {
  const date = fmtLocal(new Date(now.getTime() + 3 * 86400000), "yyyy-MM-dd");
  const t =
    paidBy === ME
      ? `Collect ${owed.map((o) => `${formatINR(o.sharePaise)} from ${o.person}`).join(", ")}`
      : `Pay ${paidBy} ${formatINR(mine)}`;
  const [r] = await createReminders([
    { title: t.length > 190 ? t.slice(0, 187) + "…" : t, notes: title, date, time: "19:00", recurrence: "none", interval: 1, priority: "normal", category: "money" },
  ]);
  return r.id;
}

async function closeReminder(reminderId: string | null) {
  if (!reminderId) return;
  const [r] = await db().select().from(reminders).where(eq(reminders.id, reminderId));
  if (!r || r.status === "archived") return;
  await cancelQueued(r.id);
  await db().update(reminders).set({ status: "archived", updatedAt: new Date() }).where(eq(reminders.id, r.id));
}

async function createSplitInner(raw: SplitInput, now = new Date()) {
  const d = splitInputSchema.parse(raw);
  const { total, computed, mine } = validate(d);
  const owedToMe = d.paidBy === ME ? others(computed) : [];

  // The expense.
  let transactionId = d.transactionId || null;
  if (transactionId) {
    // Splitting an existing expense: keep it, but bring it in line with the bill.
    await db()
      .update(transactions)
      .set({ amountPaise: d.paidBy === ME ? total : mine, category: d.category, note: d.title, date: d.date })
      .where(eq(transactions.id, transactionId));
  } else {
    const [tx] = await createTransactions([
      {
        type: "expense",
        amount: (d.paidBy === ME ? total : mine) / 100,
        category: d.category,
        note: d.paidBy === ME ? d.title : `${d.title} (${d.paidBy} paid)`,
        date: d.date,
        accountId: d.paidBy === ME ? d.accountId || null : null,
      },
    ]);
    transactionId = tx.id;
  }

  const reminderId = owedToMe.length || d.paidBy !== ME ? await followUp(d.title, d.paidBy, owedToMe, mine, now) : null;
  const [split] = await db()
    .insert(splits)
    .values({
      title: d.title,
      totalPaise: total,
      category: d.category,
      date: d.date,
      paidBy: d.paidBy,
      method: d.method,
      shares: computed,
      myPaise: mine,
      transactionId,
      accountId: d.accountId || null,
      reminderId,
    })
    .returning();

  // Dues: everyone owes you their share, or you owe the payer yours.
  const dueRows =
    d.paidBy === ME
      ? owedToMe.map((o) => ({ person: o.person, direction: "they_owe", amountPaise: o.sharePaise, note: d.title, splitId: split.id }))
      : [{ person: d.paidBy, direction: "i_owe", amountPaise: mine, note: d.title, splitId: split.id }];
  if (dueRows.length) await db().insert(dues).values(dueRows);
  return getSplit(split.id);
}

/** Change a split. People who already paid stay ticked (their payback follows the new amount). */
async function updateSplitInner(id: string, raw: SplitInput) {
  const [cur] = await db().select().from(splits).where(eq(splits.id, id));
  if (!cur) return null;
  const d = splitInputSchema.parse(raw);
  if (d.paidBy.toLowerCase() !== cur.paidBy.toLowerCase()) throw new Error("To change who paid, delete this split and make a new one");
  const { total, computed, mine } = validate(d);

  await db()
    .update(splits)
    .set({ title: d.title, totalPaise: total, category: d.category, date: d.date, method: d.method, shares: computed, myPaise: mine, accountId: d.accountId ?? cur.accountId, updatedAt: new Date() })
    .where(eq(splits.id, id));
  if (cur.transactionId) {
    await db()
      .update(transactions)
      .set({ amountPaise: d.paidBy === ME ? total : mine, category: d.category, note: d.paidBy === ME ? d.title : `${d.title} (${d.paidBy} paid)`, date: d.date })
      .where(eq(transactions.id, cur.transactionId));
  }

  const existing = await db().select().from(dues).where(eq(dues.splitId, id));
  const want =
    d.paidBy === ME
      ? others(computed).map((o) => ({ person: o.person, direction: "they_owe", amountPaise: o.sharePaise }))
      : [{ person: d.paidBy, direction: "i_owe", amountPaise: mine }];
  for (const w of want) {
    const e = existing.find((x) => x.person.toLowerCase() === w.person.toLowerCase());
    if (e) {
      await db().update(dues).set({ amountPaise: w.amountPaise, note: d.title }).where(eq(dues.id, e.id));
      if (e.settledAt && e.transactionId && w.direction === "they_owe") {
        await db().update(transactions).set({ amountPaise: w.amountPaise, note: `${e.person} paid back · ${d.title}` }).where(eq(transactions.id, e.transactionId));
      }
    } else {
      await db().insert(dues).values({ ...w, note: d.title, splitId: id });
    }
  }
  for (const e of existing.filter((x) => !want.some((w) => w.person.toLowerCase() === x.person.toLowerCase()))) {
    if (e.transactionId && e.direction === "they_owe") await db().delete(transactions).where(eq(transactions.id, e.transactionId));
    await db().delete(dues).where(eq(dues.id, e.id));
  }
  await syncSplitReminder(id);
  return getSplit(id);
}

/**
 * Remove a split: its dues and paybacks go. The expense goes too when the split created it
 * for a friend-paid bill, or when you ask for the whole bill to be deleted.
 */
async function deleteSplitInner(id: string, opts: { deleteExpense?: boolean } = {}) {
  const [s] = await db().select().from(splits).where(eq(splits.id, id));
  if (!s) return false;
  const ds = await db().select().from(dues).where(eq(dues.splitId, id));
  const paybacks = ds.filter((x) => x.direction === "they_owe" && x.transactionId).map((x) => x.transactionId!);
  if (paybacks.length) await db().delete(transactions).where(inArray(transactions.id, paybacks));
  await db().delete(dues).where(eq(dues.splitId, id));
  if (s.transactionId && (s.paidBy !== ME || opts.deleteExpense)) await db().delete(transactions).where(eq(transactions.id, s.transactionId));
  await closeReminder(s.reminderId);
  await db().delete(splits).where(eq(splits.id, id));
  return true;
}

/** When everyone has paid, the follow-up reminder goes away (and comes back if you un-tick). */
export async function syncSplitReminder(splitId: string) {
  const [s] = await db().select().from(splits).where(eq(splits.id, splitId));
  if (!s?.reminderId) return;
  const open = await db().select().from(dues).where(and(eq(dues.splitId, splitId), isNull(dues.settledAt)));
  const [r] = await db().select().from(reminders).where(eq(reminders.id, s.reminderId));
  if (!r) return;
  if (!open.length && r.status !== "archived") await closeReminder(r.id);
  if (open.length && r.status === "archived") {
    await db().update(reminders).set({ status: "active", updatedAt: new Date() }).where(eq(reminders.id, r.id));
    const { planAndQueue } = await import("./scheduler");
    await planAndQueue({ reminderIds: [r.id] });
  }
}

export type SplitView = Split & { dues: Due[]; backPaise: number; owedPaise: number };

export async function getSplit(id: string): Promise<SplitView | null> {
  const [s] = await db().select().from(splits).where(eq(splits.id, id));
  if (!s) return null;
  const ds = await db().select().from(dues).where(eq(dues.splitId, id));
  return withTotals(s, ds);
}

function withTotals(s: Split, ds: Due[]): SplitView {
  const theyOwe = ds.filter((d) => d.direction === "they_owe");
  return {
    ...s,
    dues: ds.sort((a, b) => a.person.localeCompare(b.person)),
    backPaise: theyOwe.filter((d) => d.settledAt).reduce((a, d) => a + d.amountPaise, 0),
    owedPaise: theyOwe.reduce((a, d) => a + d.amountPaise, 0),
  };
}

/** Everything the Splits tab shows: totals, one line per person, and recent splits. */
export async function splitsOverview() {
  const [ss, allDues] = await Promise.all([db().select().from(splits).orderBy(desc(splits.date), desc(splits.createdAt)).limit(100), db().select().from(dues).orderBy(desc(dues.createdAt))]);
  const open = allDues.filter((d) => !d.settledAt);
  const byPerson = new Map<string, { person: string; theyOwe: number; iOwe: number; items: { id: string; title: string; amountPaise: number; direction: string; splitId: string | null; createdAt: Date }[] }>();
  for (const d of open) {
    const k = d.person.toLowerCase();
    const p = byPerson.get(k) || { person: d.person, theyOwe: 0, iOwe: 0, items: [] };
    if (d.direction === "they_owe") p.theyOwe += d.amountPaise;
    else p.iOwe += d.amountPaise;
    p.items.push({ id: d.id, title: d.note || "Due", amountPaise: d.amountPaise, direction: d.direction, splitId: d.splitId, createdAt: d.createdAt });
    byPerson.set(k, p);
  }
  const people = [...byPerson.values()]
    .map((p) => ({ ...p, net: p.theyOwe - p.iOwe }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  return {
    theyOwe: open.filter((d) => d.direction === "they_owe").reduce((a, d) => a + d.amountPaise, 0),
    iOwe: open.filter((d) => d.direction === "i_owe").reduce((a, d) => a + d.amountPaise, 0),
    people,
    splits: ss.map((s) => withTotals(s, allDues.filter((d) => d.splitId === s.id))),
    // Plain IOUs ("Arun owes me 500"), not tied to a bill.
    loose: allDues.filter((d) => !d.splitId).slice(0, 40),
  };
}

/** Names you've split with or recorded dues for, most recent first (for quick picking). */
export async function knownPeople() {
  const rows = await db().select({ person: dues.person, at: dues.createdAt }).from(dues).orderBy(desc(dues.createdAt)).limit(300);
  const seen = new Map<string, string>();
  for (const r of rows) if (!seen.has(r.person.toLowerCase())) seen.set(r.person.toLowerCase(), r.person);
  return [...seen.values()].slice(0, 30);
}

// ------------------------------------------------------------- groups

export const groupInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  members: z.array(z.string().trim().min(1).max(40)).min(1).max(30),
});

export async function listGroups() {
  return db().select().from(splitGroups).orderBy(splitGroups.name);
}
async function saveGroupInner(input: z.infer<typeof groupInputSchema>, id?: string) {
  const members = [...new Set(input.members.map((m) => m.replace(/^\w/, (c) => c.toUpperCase())))].filter((m) => !/^(me|you)$/i.test(m));
  if (id) {
    const [g] = await db().update(splitGroups).set({ name: input.name, members }).where(eq(splitGroups.id, id)).returning();
    return g;
  }
  const [g] = await db().insert(splitGroups).values({ name: input.name, members }).returning();
  return g;
}
async function deleteGroupInner(id: string) {
  await db().delete(splitGroups).where(eq(splitGroups.id, id));
}

/** Turn a validation error into one short sentence for the form. */
export function friendly(e: unknown) {
  const err = e as { issues?: { message: string; path: (string | number)[] }[]; message?: string };
  if (err.issues?.length) {
    const i = err.issues[0];
    if (i.path[0] === "people") return "Pick at least two people (you and someone else)";
    if (i.path[0] === "amount") return "Enter the bill amount";
    if (i.path[0] === "title") return "Give the bill a name";
    return i.message;
  }
  return err.message || "Couldn't save the split";
}

/** One line for Telegram / toasts: "Dinner ₹1,200 · your share ₹400 · Arun ₹400, Riya ₹400 owe you". */
export function splitSummary(s: SplitView | null) {
  if (!s) return "";
  const owe = s.dues.filter((d) => d.direction === "they_owe");
  const tail =
    s.paidBy === ME
      ? owe.length
        ? `${owe.map((d) => `${d.person} ${formatINR(d.amountPaise)}`).join(", ")} ${owe.length === 1 ? "owes" : "owe"} you`
        : "nobody owes you"
      : `you owe ${s.paidBy} ${formatINR(s.myPaise)}`;
  return `🧾 ${s.title} ${formatINR(s.totalPaise)} · your share ${formatINR(s.myPaise)} · ${tail}`;
}

// ------------------------------------------------------------- undoable wrappers

/** Everything a split touches, so Undo can put it back exactly. */
async function snapSplit(id: string) {
  const u = await import("./undo");
  const [s] = await db().select().from(splits).where(eq(splits.id, id));
  if (!s) return null;
  const ds = await db().select().from(dues).where(eq(dues.splitId, id));
  const ops = [
    await u.snap("transactions", [s.transactionId, ...ds.map((x) => x.transactionId)]),
    await u.snapReminder(s.reminderId),
    await u.snap("splits", [id]),
    await u.snapWhere("dues", "splitId", id),
  ].filter(Boolean) as import("./undo").Op[];
  return { op: "seq" as const, ops };
}

export async function createSplit(raw: SplitInput, now = new Date()) {
  const u = await import("./undo");
  return u.recorded({ title: (v: SplitView | null) => (v ? `Split ${v.title} ${u.money(v.totalPaise)}` : null), kind: "add" }, async (rec) => {
    if (raw.transactionId) rec(await u.snap("transactions", [raw.transactionId]));
    const v = await createSplitInner(raw, now);
    if (v) {
      rec(u.removed("dues", v.dues.map((d) => d.id)));
      rec(u.removed("splits", [v.id]));
    }
    return v;
  });
}

export async function updateSplit(id: string, raw: SplitInput) {
  const u = await import("./undo");
  const [cur] = await db().select().from(splits).where(eq(splits.id, id));
  return u.recorded({ title: cur ? `Edited split ${cur.title}` : null, kind: "edit" }, async (rec) => {
    rec(await snapSplit(id));
    return updateSplitInner(id, raw);
  });
}

export async function deleteSplit(id: string, opts: { deleteExpense?: boolean } = {}) {
  const u = await import("./undo");
  const [cur] = await db().select().from(splits).where(eq(splits.id, id));
  return u.recorded({ title: cur ? `Deleted split ${cur.title}` : null, kind: "delete" }, async (rec) => {
    rec(await snapSplit(id));
    return deleteSplitInner(id, opts);
  });
}

export async function saveGroup(input: z.infer<typeof groupInputSchema>, id?: string) {
  const u = await import("./undo");
  return u.recorded({ title: `${id ? "Edited" : "Added"} group ${input.name}`, kind: id ? "edit" : "add" }, async (rec) => {
    if (id) rec(await u.snap("splitGroups", [id]));
    const g = await saveGroupInner(input, id);
    if (!id && g) rec(u.removed("splitGroups", [g.id]));
    return g;
  });
}

export async function deleteGroup(id: string) {
  const u = await import("./undo");
  const [g] = await db().select().from(splitGroups).where(eq(splitGroups.id, id));
  if (!g) return;
  await u.changeRow("splitGroups", id, `Deleted group ${g.name}`, "delete", () => deleteGroupInner(id));
}
