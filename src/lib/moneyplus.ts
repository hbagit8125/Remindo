import { isoDay } from "./day";
import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, accounts, favourites, dues, goals, goalContributions, transactions, type Transaction } from "@/db";
import { ACCOUNT_KINDS, formatINR, toPaise, transactionInputSchema, type TransactionInput } from "./money";
import { createTransactions, createReminders } from "./create";
import { fmtLocal } from "./time";
import { summarize, listTransactions, shiftMonth } from "./finance";

const day = isoDay();

// ------------------------------------------------------------- accounts

export const accountInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(ACCOUNT_KINDS).default("bank"),
  openingBalance: z.coerce.number().min(-100_000_000).max(100_000_000).default(0),
});

/** Accounts with current balances (opening + income − expenses ± transfers). */
export async function listAccounts() {
  const rows = await db().select().from(accounts).where(eq(accounts.archived, false)).orderBy(asc(accounts.createdAt));
  if (!rows.length) return [];
  const sums = await db()
    .select({
      accountId: transactions.accountId,
      toAccountId: transactions.toAccountId,
      type: transactions.type,
      total: sql<number>`sum(${transactions.amountPaise})`.mapWith(Number),
    })
    .from(transactions)
    .groupBy(transactions.accountId, transactions.toAccountId, transactions.type);
  return rows.map((a) => {
    let bal = a.openingBalancePaise;
    for (const s of sums) {
      if (s.accountId === a.id) bal += s.type === "income" ? s.total : -s.total;
      if (s.type === "transfer" && s.toAccountId === a.id) bal += s.total;
    }
    return { ...a, balancePaise: bal };
  });
}

// ------------------------------------------------------------- favourites

export const favouriteInputSchema = z.object({
  label: z.string().trim().min(1).max(40),
  payload: transactionInputSchema.omit({ date: true }),
});

export async function listFavourites() {
  return db().select().from(favourites).orderBy(asc(favourites.sortOrder), asc(favourites.createdAt));
}

/** Log a favourite as today's entry. */
export async function logFavourite(id: string, now = new Date()) {
  const [f] = await db().select().from(favourites).where(eq(favourites.id, id));
  if (!f) return null;
  const [tx] = await createTransactions([{ ...(f.payload as Omit<TransactionInput, "date">), date: fmtLocal(now, "yyyy-MM-dd") }]);
  return tx;
}

/** Entries you log often (same note + amount, 3+ times in 60 days) that aren't favourites yet. */
export async function suggestFavourites(now = new Date()) {
  const since = fmtLocal(new Date(now.getTime() - 60 * 86400000), "yyyy-MM-dd");
  const rows = await db()
    .select({
      note: transactions.note,
      category: transactions.category,
      amountPaise: transactions.amountPaise,
      method: transactions.method,
      n: sql<number>`count(*)`.mapWith(Number),
    })
    .from(transactions)
    .where(and(eq(transactions.type, "expense"), gte(transactions.date, since)))
    .groupBy(transactions.note, transactions.category, transactions.amountPaise, transactions.method)
    .having(sql`count(*) >= 3`)
    .orderBy(desc(sql`count(*)`))
    .limit(5);
  const favs = await listFavourites();
  const key = (note: string | null, amt: number) => `${(note || "").toLowerCase()}|${amt}`;
  const have = new Set(favs.map((f) => key((f.payload as TransactionInput).note || null, toPaise((f.payload as TransactionInput).amount))));
  return rows
    .filter((r) => !have.has(key(r.note, r.amountPaise)))
    .map((r) => ({
      label: `${r.note || r.category} ${formatINR(r.amountPaise)}`,
      count: r.n,
      payload: { type: "expense" as const, amount: r.amountPaise / 100, category: r.category, note: r.note, method: r.method as TransactionInput["method"] },
    }));
}

// ------------------------------------------------------------- dues (split & owe)

export const dueInputSchema = z.object({
  person: z.string().trim().min(1).max(60),
  direction: z.enum(["they_owe", "i_owe"]),
  amount: z.coerce.number().positive().max(100_000_000),
  note: z.string().trim().max(200).nullish(),
  /** Remind me to collect/pay on this date (default: 3 days). null = no reminder. */
  remindOn: day.nullish(),
});
export type DueInput = z.infer<typeof dueInputSchema>;

export async function createDues(items: DueInput[], now = new Date()) {
  const out = [];
  for (const d of items) {
    // No date given (AI sends null, the form leaves it empty) → follow up in 3 days.
    const remindOn = d.remindOn || fmtLocal(new Date(now.getTime() + 3 * 86400000), "yyyy-MM-dd");
    let reminderId: string | null = null;
    if (remindOn) {
      const [r] = await createReminders([
        {
          title: d.direction === "they_owe" ? `Collect ${formatINR(toPaise(d.amount))} from ${d.person}` : `Pay back ${d.person} ${formatINR(toPaise(d.amount))}`,
          notes: d.note || null,
          date: remindOn,
          time: "19:00",
          recurrence: "none",
          interval: 1,
          priority: "normal",
          category: "money",
        },
      ]);
      reminderId = r.id;
    }
    const [row] = await db()
      .insert(dues)
      .values({ person: d.person, direction: d.direction, amountPaise: toPaise(d.amount), note: d.note || null, reminderId })
      .returning();
    out.push(row);
  }
  return out;
}

export async function listDues() {
  const rows = await db().select().from(dues).orderBy(desc(dues.createdAt));
  const open = rows.filter((r) => !r.settledAt);
  return {
    open,
    settled: rows.filter((r) => r.settledAt).slice(0, 20),
    theyOwe: open.filter((r) => r.direction === "they_owe").reduce((s, r) => s + r.amountPaise, 0),
    iOwe: open.filter((r) => r.direction === "i_owe").reduce((s, r) => s + r.amountPaise, 0),
  };
}

/**
 * Mark settled and log the money.
 * - They paid you back → income "Refund" (added to your account).
 * - You paid back a plain due → expense.
 * - You paid back your share of a split → no new expense (your share was already counted);
 *   the split's expense is moved to the account you paid from.
 * The due's follow-up reminder is closed (and taken off today's lists).
 */
export async function settleDue(id: string, opts: { log: boolean; accountId?: string | null }, now = new Date()) {
  const [d] = await db().update(dues).set({ settledAt: new Date() }).where(and(eq(dues.id, id), isNull(dues.settledAt))).returning();
  if (!d) return null;
  if (d.reminderId) {
    const { completeOccurrence } = await import("./scheduler");
    const { reminders } = await import("@/db");
    const [r] = await db().select().from(reminders).where(eq(reminders.id, d.reminderId));
    if (r && r.status === "active") await completeOccurrence(r.id, r.dueAt);
    if (r) await db().update(reminders).set({ status: "archived", updatedAt: new Date() }).where(eq(reminders.id, r.id));
  }
  const splitOwe = d.splitId && d.direction === "i_owe";
  if (splitOwe) {
    const { splits, transactions } = await import("@/db");
    const [sp] = await db().select().from(splits).where(eq(splits.id, d.splitId!));
    if (sp?.transactionId && (opts.accountId || sp.accountId)) {
      await db().update(transactions).set({ accountId: opts.accountId || sp.accountId }).where(eq(transactions.id, sp.transactionId));
    }
  } else if (opts.log) {
    let accountId = opts.accountId || null;
    if (!accountId && d.splitId) {
      const { splits } = await import("@/db");
      accountId = (await db().select().from(splits).where(eq(splits.id, d.splitId)))[0]?.accountId || null;
    }
    const [tx] = await createTransactions([
      d.direction === "they_owe"
        ? { type: "income", amount: d.amountPaise / 100, category: "Refund", note: `${d.person} paid back${d.note ? ` · ${d.note}` : ""}`, date: fmtLocal(now, "yyyy-MM-dd"), accountId }
        : { type: "expense", amount: d.amountPaise / 100, category: "Other", note: `Paid back ${d.person}${d.note ? ` · ${d.note}` : ""}`, date: fmtLocal(now, "yyyy-MM-dd"), accountId },
    ]);
    // Link the payback to the due so it can be traced (and undone).
    if (tx) await db().update(dues).set({ transactionId: tx.id }).where(eq(dues.id, d.id));
  }
  if (d.splitId) await import("./splits").then((m) => m.syncSplitReminder(d.splitId!));
  return d;
}

/** Undo "paid back": the due is open again and its payback entry is removed. */
export async function unsettleDue(id: string) {
  const [d] = await db().select().from(dues).where(eq(dues.id, id));
  if (!d || !d.settledAt) return null;
  const { transactions } = await import("@/db");
  if (d.transactionId) await db().delete(transactions).where(eq(transactions.id, d.transactionId));
  const [row] = await db().update(dues).set({ settledAt: null, transactionId: null }).where(eq(dues.id, id)).returning();
  if (d.splitId) await import("./splits").then((m) => m.syncSplitReminder(d.splitId!));
  return row;
}

/** Settle up with someone: every open due with them, at once. */
export async function settlePerson(person: string, opts: { accountId?: string | null } = {}, now = new Date()) {
  const open = await db().select().from(dues).where(and(isNull(dues.settledAt)));
  const mine = open.filter((d) => d.person.toLowerCase() === person.toLowerCase());
  for (const d of mine) await settleDue(d.id, { log: true, accountId: opts.accountId }, now);
  return mine.length;
}

// ------------------------------------------------------------- goals

export const goalInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  emoji: z.string().max(8).nullish(),
  target: z.coerce.number().positive().max(1_000_000_000),
  deadline: day.nullish(),
});

export async function listGoals(now = new Date()) {
  const rows = await db().select().from(goals).where(eq(goals.archived, false)).orderBy(asc(goals.createdAt));
  if (!rows.length) return [];
  const sums = await db()
    .select({ goalId: goalContributions.goalId, saved: sql<number>`sum(${goalContributions.amountPaise})`.mapWith(Number) })
    .from(goalContributions)
    .groupBy(goalContributions.goalId);
  const thisMonth = fmtLocal(now, "yyyy-MM");
  const monthSums = await db()
    .select({ goalId: goalContributions.goalId, saved: sql<number>`sum(${goalContributions.amountPaise})`.mapWith(Number) })
    .from(goalContributions)
    .where(gte(goalContributions.date, `${thisMonth}-01`))
    .groupBy(goalContributions.goalId);
  return rows.map((g) => {
    const saved = sums.find((s) => s.goalId === g.id)?.saved || 0;
    const left = Math.max(0, g.targetPaise - saved);
    const savedThisMonth = monthSums.find((s) => s.goalId === g.id)?.saved || 0;
    let monthsLeft: number | null = null;
    if (g.deadline) {
      const [y, m] = g.deadline.split("-").map(Number);
      const [cy, cm] = thisMonth.split("-").map(Number);
      // Count this month only if you haven't put anything aside yet this month.
      monthsLeft = Math.max(1, (y - cy) * 12 + (m - cm) + (savedThisMonth > 0 ? 0 : 1));
    }
    return {
      ...g,
      savedPaise: saved,
      savedThisMonthPaise: savedThisMonth,
      // Whole rupees, rounded up.
      perMonthPaise: monthsLeft ? Math.ceil(left / monthsLeft / 100) * 100 : null,
      monthsLeft,
    };
  });
}

export async function addContribution(goalId: string, amount: number, note: string | null, now = new Date()) {
  const [row] = await db()
    .insert(goalContributions)
    .values({ goalId, amountPaise: toPaise(amount), note, date: fmtLocal(now, "yyyy-MM-dd") })
    .returning();
  return row;
}

// ------------------------------------------------------------- yearly view

/** 12 months of spend/income, and the top categories' monthly trend. */
export async function yearInsights(year: number) {
  const rows = await db()
    .select()
    .from(transactions)
    .where(and(gte(transactions.date, `${year}-01-01`), lt(transactions.date, `${year + 1}-01-01`)));
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const byMonth = months.map((m) => {
    const s = summarize(m, rows.filter((r) => r.date.startsWith(m)));
    return { month: m, spent: s.spent, income: s.income };
  });
  const total = summarize(String(year), rows);
  const top = total.byCategory.slice(0, 5).map((c) => ({
    category: c.category,
    total: c.amount,
    months: months.map((m) => rows.filter((r) => r.type === "expense" && r.category === c.category && r.date.startsWith(m)).reduce((s, r) => s + r.amountPaise, 0)),
  }));
  return { year, months: byMonth, spent: total.spent, income: total.income, topCategories: top, byCategory: total.byCategory };
}

// ------------------------------------------------------------- monthly report

export async function monthlyReportData(month: string) {
  const [cur, prev] = await Promise.all([listTransactions(month), listTransactions(shiftMonth(month, -1))]);
  const s = summarize(month, cur);
  const p = summarize(shiftMonth(month, -1), prev);
  const biggest = cur.filter((t) => t.type === "expense").sort((a, b) => b.amountPaise - a.amountPaise)[0] as Transaction | undefined;
  return { month, current: s, previous: p, biggest, goals: await listGoals(), dues: await listDues() };
}
