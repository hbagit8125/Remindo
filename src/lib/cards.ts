import { and, eq, inArray, or } from "drizzle-orm";
import { db, accounts, reminders, transactions, type Account } from "@/db";
import { formatINR } from "./money";
import { fmtLocal, localToUtc } from "./time";
import type { ReminderInput } from "./reminder-input";

/**
 * Credit cards.
 *
 * A card is an account whose balance is what you owe (negative = owed). Spending on it is an
 * expense tagged with the card; paying the bill is a transfer from your bank to the card, so it
 * is never counted as spending twice. With the bill day and due day we work out this month's
 * bill, what's still due, and keep a monthly "Pay the bill" reminder with the right amount.
 */

export type CardStatus = "setup" | "nobill" | "due" | "overdue" | "paid";

export type CardSummary = {
  /** What you owe right now (positive). */
  outstandingPaise: number;
  limitPaise: number | null;
  availablePaise: number | null;
  /** 0–100+ */
  usedPct: number | null;
  lastStatement: string | null;
  nextStatement: string | null;
  dueDate: string | null;
  /** The bill generated on lastStatement. */
  billPaise: number;
  /** Paid towards it since then. */
  paidPaise: number;
  /** Still to pay before dueDate. */
  duePaise: number;
  /** Spent since the last bill (goes on the next one). */
  unbilledPaise: number;
  status: CardStatus;
  daysToDue: number | null;
};

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1–12
const ymd = (y: number, m: number, d: number) => {
  // Normalise month overflow (13 → next year) and clamp the day to the month (31st → 30th/28th).
  const yy = y + Math.floor((m - 1) / 12);
  const mm = ((((m - 1) % 12) + 12) % 12) + 1;
  return `${yy}-${pad(mm)}-${pad(Math.min(d, daysIn(yy, mm)))}`;
};
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

/** The latest bill date on/before today, the next one, and when the latest bill must be paid. */
export function cycleDates(statementDay: number, dueDay: number, today: string) {
  const [y, m] = today.split("-").map(Number);
  let last = ymd(y, m, statementDay);
  if (last > today) last = ymd(y, m - 1, statementDay);
  const [ly, lm] = last.split("-").map(Number);
  const next = ymd(ly, lm + 1, statementDay);
  // Due day after the bill day = same month; otherwise next month (bill on 20th, pay by 5th).
  let due = ymd(ly, lm, dueDay);
  if (due <= last) due = ymd(ly, lm + 1, dueDay);
  return { last, next, due };
}

type Tx = { type: string; amountPaise: number; date: string; accountId: string | null; toAccountId: string | null };

/** Money going onto the card (+) or paying it off (−). */
function effect(t: Tx, cardId: string) {
  if (t.accountId === cardId) return t.type === "income" ? -t.amountPaise : t.amountPaise; // spend / cash withdrawal; income = refund
  if (t.toAccountId === cardId && t.type === "transfer") return -t.amountPaise; // bill payment
  return 0;
}

export function summarize(card: Pick<Account, "id" | "openingBalancePaise" | "creditLimitPaise" | "statementDay" | "dueDay">, txs: Tx[], today: string): CardSummary {
  const mine = txs.filter((t) => t.accountId === card.id || t.toAccountId === card.id);
  const opening = -card.openingBalancePaise; // stored as a (negative) balance
  const outstanding = opening + mine.reduce((s, t) => s + effect(t, card.id), 0);
  const limit = card.creditLimitPaise ?? null;
  const base = {
    outstandingPaise: outstanding,
    limitPaise: limit,
    availablePaise: limit !== null ? limit - outstanding : null,
    usedPct: limit ? Math.round((Math.max(0, outstanding) / limit) * 100) : null,
  };
  if (!card.statementDay || !card.dueDay) {
    return { ...base, lastStatement: null, nextStatement: null, dueDate: null, billPaise: 0, paidPaise: 0, duePaise: 0, unbilledPaise: 0, status: "setup", daysToDue: null };
  }
  const { last, next, due } = cycleDates(card.statementDay, card.dueDay, today);
  const atStatement = opening + mine.filter((t) => t.date <= last).reduce((s, t) => s + effect(t, card.id), 0);
  const after = mine.filter((t) => t.date > last);
  const paid = after.reduce((s, t) => s + Math.max(0, -effect(t, card.id)), 0);
  const unbilled = after.reduce((s, t) => s + Math.max(0, effect(t, card.id)), 0);
  const bill = Math.max(0, atStatement);
  const left = Math.max(0, bill - paid);
  const daysToDue = diffDays(today, due);
  const status: CardStatus = !bill ? "nobill" : !left ? "paid" : daysToDue < 0 ? "overdue" : "due";
  return { ...base, lastStatement: last, nextStatement: next, dueDate: due, billPaise: bill, paidPaise: Math.min(paid, bill), duePaise: left, unbilledPaise: unbilled, status, daysToDue };
}

const todayStr = () => fmtLocal(new Date(), "yyyy-MM-dd");

/** Summaries for every card (one query). */
export async function cardSummaries(today = todayStr()) {
  const cards = await db()
    .select()
    .from(accounts)
    .where(and(eq(accounts.kind, "card"), eq(accounts.archived, false)));
  if (!cards.length) return new Map<string, CardSummary>();
  const ids = cards.map((c) => c.id);
  const txs = await db()
    .select({ type: transactions.type, amountPaise: transactions.amountPaise, date: transactions.date, accountId: transactions.accountId, toAccountId: transactions.toAccountId })
    .from(transactions)
    .where(or(inArray(transactions.accountId, ids), inArray(transactions.toAccountId, ids)));
  return new Map(cards.map((c) => [c.id, summarize(c, txs, today)]));
}

// ------------------------------------------------------------- the monthly "Pay the bill" reminder

function billReminder(card: Account, s: CardSummary): ReminderInput {
  const nextDue = s.dueDate && s.duePaise > 0 ? s.dueDate : cycleDates(card.statementDay!, card.dueDay!, s.nextStatement || todayStr()).due;
  return {
    title: `Pay ${card.name} bill`,
    notes: "Credit card bill. Tap “Log paid” to record the payment from your bank (it isn't counted as spending again).",
    date: nextDue,
    time: "10:00",
    recurrence: "monthly",
    monthDay: card.dueDay!,
    interval: 1,
    priority: "high",
    category: "bills",
    amount: s.duePaise > 0 ? s.duePaise / 100 : null,
    // A few days ahead, the day before, and on the day.
    leadTimes: [60 * 24 * 3, 60 * 24, 0],
  };
}

/**
 * Keep a card's bill reminder in step: create it when bill/due days are set, remove it when they're
 * cleared, update the amount to what's still due, and tick this month off once the bill is paid.
 */
export async function syncCardReminder(cardId: string, today = todayStr()) {
  const [card] = await db().select().from(accounts).where(eq(accounts.id, cardId));
  if (!card) return;
  const life = await import("./life");
  const wants = card.kind === "card" && !card.archived && card.statementDay && card.dueDay;
  if (!wants) {
    if (card.reminderId) {
      await life.deleteReminder(card.reminderId);
      await db().update(accounts).set({ reminderId: null }).where(eq(accounts.id, card.id));
    }
    return;
  }
  const s = (await cardSummaries(today)).get(card.id)!;
  const input = billReminder(card, s);
  const [existing] = card.reminderId ? await db().select().from(reminders).where(eq(reminders.id, card.reminderId)) : [];
  const amountPaise = input.amount ? Math.round(input.amount * 100) : null;
  if (!existing) {
    const id = await life.upsertReminder(null, input, { kind: "card", id: card.id });
    await db().update(accounts).set({ reminderId: id }).where(eq(accounts.id, card.id));
    return;
  }
  const prev = existing.input as Partial<ReminderInput> | null;
  const sameShape = existing.title === input.title && prev?.monthDay === card.dueDay && existing.status === "active" && Boolean(existing.rrule);
  if (!sameShape) {
    await life.upsertReminder(existing.id, input, { kind: "card", id: card.id });
  } else if (existing.amountPaise !== amountPaise) {
    // Only the amount changed: no need to re-plan alerts.
    await db().update(reminders).set({ amountPaise, updatedAt: new Date() }).where(eq(reminders.id, existing.id));
  }
  // Paid in full → this month's "Pay the bill" is done.
  if (s.status === "paid" && s.dueDate) {
    const occ = localToUtc(s.dueDate, "10:00");
    const { completions } = await import("@/db");
    const [done] = await db()
      .select()
      .from(completions)
      .where(and(eq(completions.reminderId, existing.id), eq(completions.occurrenceAt, occ)));
    if (!done) await import("./scheduler").then((m) => m.completeOccurrence(existing.id, occ, "app"));
  }
}

/** After entries change: refresh the cards they touch. */
export async function syncCardsFor(accountIds: (string | null | undefined)[]) {
  const ids = [...new Set(accountIds.filter(Boolean) as string[])];
  if (!ids.length) return;
  const cards = await db()
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(inArray(accounts.id, ids), eq(accounts.kind, "card")));
  for (const c of cards) await syncCardReminder(c.id).catch((e) => console.error("[remindo:cards]", e));
}

/** Daily: amounts and "paid" ticks for every card. */
export async function syncAllCards() {
  const cards = await db().select({ id: accounts.id }).from(accounts).where(eq(accounts.kind, "card"));
  for (const c of cards) await syncCardReminder(c.id).catch((e) => console.error("[remindo:cards]", e));
}

/** The bank account a card's bill is paid from (the one you picked, else your first bank account). */
export async function payFromAccount(card: Account) {
  if (card.payFromId) {
    const [a] = await db().select().from(accounts).where(and(eq(accounts.id, card.payFromId), eq(accounts.archived, false)));
    if (a) return a;
  }
  const [bank] = await db()
    .select()
    .from(accounts)
    .where(and(eq(accounts.kind, "bank"), eq(accounts.archived, false)))
    .orderBy(accounts.createdAt)
    .limit(1);
  return bank ?? null;
}

export const cardLine = (name: string, s: CardSummary) =>
  s.status === "due" || s.status === "overdue"
    ? `💳 ${name}: ${formatINR(s.duePaise)} ${s.status === "overdue" ? "overdue" : `due ${s.daysToDue === 0 ? "today" : s.daysToDue === 1 ? "tomorrow" : `in ${s.daysToDue} days`}`}`
    : null;
