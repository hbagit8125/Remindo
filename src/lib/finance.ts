import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db, transactions, budgets, budgetAlerts, reminders, type Transaction } from "@/db";
import { formatINR, toPaise, TOTAL_BUDGET, type TransactionInput } from "./money";
import { sendEmail, layout, esc } from "./email";
import { fmtLocal } from "./time";

export const monthOf = (date: string) => date.slice(0, 7);
export const currentMonth = () => fmtLocal(new Date(), "yyyy-MM");
export const today = () => fmtLocal(new Date(), "yyyy-MM-dd");

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthRange(month: string) {
  return { from: `${month}-01`, to: `${shiftMonth(month, 1)}-01` };
}

export function inputToTxRow(i: TransactionInput) {
  return {
    type: i.type,
    amountPaise: toPaise(i.amount),
    category: i.category,
    note: i.note || null,
    merchant: i.merchant || null,
    method: i.type === "transfer" ? null : i.method || null,
    date: i.date,
    accountId: i.accountId || null,
    toAccountId: i.type === "transfer" ? i.toAccountId || null : null,
  };
}

export async function listTransactions(month: string) {
  const { from, to } = monthRange(month);
  return db()
    .select()
    .from(transactions)
    .where(and(gte(transactions.date, from), lt(transactions.date, to)))
    .orderBy(desc(transactions.date), desc(transactions.createdAt));
}

export async function listAllTransactions() {
  return db().select().from(transactions).orderBy(asc(transactions.date), asc(transactions.createdAt));
}

export type MonthSummary = {
  month: string;
  spent: number;
  income: number;
  byCategory: { category: string; amount: number }[];
  byDay: { date: string; amount: number }[];
  count: number;
};

export function summarize(month: string, rows: Transaction[]): MonthSummary {
  const exp = rows.filter((r) => r.type === "expense");
  const cat = new Map<string, number>();
  const day = new Map<string, number>();
  for (const r of exp) {
    cat.set(r.category, (cat.get(r.category) || 0) + r.amountPaise);
    day.set(r.date, (day.get(r.date) || 0) + r.amountPaise);
  }
  return {
    month,
    spent: exp.reduce((s, r) => s + r.amountPaise, 0),
    income: rows.filter((r) => r.type === "income").reduce((s, r) => s + r.amountPaise, 0),
    byCategory: [...cat.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    byDay: [...day.entries()].map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date)),
    count: rows.length,
  };
}

export async function getBudgets() {
  const rows = await db().select().from(budgets);
  return Object.fromEntries(rows.map((b) => [b.category, b.amountPaise])) as Record<string, number>;
}

/** Replace all budgets. Values are rupees; 0 or missing removes a budget. */
export async function setBudgets(input: Record<string, number>) {
  await db().delete(budgets);
  const rows = Object.entries(input)
    .filter(([, v]) => v > 0)
    .map(([category, v]) => ({ category, amountPaise: toPaise(v) }));
  if (rows.length) await db().insert(budgets).values(rows);
  return getBudgets();
}

/** Everything the Insights screen needs for one month. */
export async function insights(month: string) {
  const [cur, prev, b] = await Promise.all([listTransactions(month), listTransactions(shiftMonth(month, -1)), getBudgets()]);
  const s = summarize(month, cur);
  const p = summarize(shiftMonth(month, -1), prev);
  return {
    ...s,
    prevSpent: p.spent,
    prevByCategory: p.byCategory,
    budgets: b,
  };
}

/**
 * After new expenses, email once when a budget passes 80% and once at 100%
 * (per month and category).
 */
export async function checkBudgetAlerts(months: string[]) {
  const b = await getBudgets();
  if (!Object.keys(b).length) return;
  for (const month of [...new Set(months)]) {
    const s = summarize(month, await listTransactions(month));
    const spentFor = (cat: string) =>
      cat === TOTAL_BUDGET ? s.spent : s.byCategory.find((c) => c.category === cat)?.amount || 0;
    for (const [cat, limit] of Object.entries(b)) {
      const spent = spentFor(cat);
      const pct = (spent / limit) * 100;
      const threshold = pct >= 100 ? 100 : pct >= 80 ? 80 : 0;
      if (!threshold) continue;
      const [inserted] = await db()
        .insert(budgetAlerts)
        .values({ month, category: cat, threshold })
        .onConflictDoNothing()
        .returning();
      if (!inserted) continue;
      const name = cat === TOTAL_BUDGET ? "Monthly budget" : `${cat} budget`;
      const over = threshold === 100;
      await sendEmail(
        `${over ? "🚨" : "⚠️"} ${name}: ${Math.round(pct)}% used`,
        layout(
          `${name} ${over ? "exceeded" : "almost used"}`,
          `<p style="font-size:15px;color:#374151;margin:0 0 12px">You've spent <b>${esc(formatINR(spent))}</b> of <b>${esc(formatINR(limit))}</b> in ${esc(fmtLocal(new Date(`${month}-15T12:00:00Z`), "MMMM"))}.</p>
           ${budgetBar(spent, limit)}
           <p style="font-size:13px;color:#6b7280;margin:12px 0 0">${over ? `That's ${esc(formatINR(spent - limit))} over.` : `${esc(formatINR(limit - spent))} left for the month.`}</p>`,
        ),
      ).catch(() => null);
    }
  }
}

export function budgetBar(spent: number, limit: number) {
  const pct = Math.min(100, Math.round((spent / limit) * 100));
  const color = pct >= 100 ? "#f43f5e" : pct >= 80 ? "#f59e0b" : "#10b981";
  return `<div style="background:#f3f4f6;border-radius:8px;height:10px;overflow:hidden"><div style="width:${pct}%;background:${color};height:10px"></div></div>`;
}

/** Log a bill reminder's amount as an expense for one occurrence (once). */
export async function logReminderPayment(reminderId: string, occurrenceAt: Date) {
  const [r] = await db().select().from(reminders).where(eq(reminders.id, reminderId));
  if (!r?.amountPaise) return { error: "This reminder has no amount" as const };
  const [existing] = await db()
    .select()
    .from(transactions)
    .where(and(eq(transactions.reminderId, reminderId), eq(transactions.occurrenceAt, occurrenceAt)));
  if (existing) return { transaction: existing, already: true };
  const [tx] = await db()
    .insert(transactions)
    .values({
      type: "expense",
      amountPaise: r.amountPaise,
      category: guessCategoryFromReminder(r.title, r.category),
      note: r.title,
      date: today(),
      reminderId,
      occurrenceAt,
    })
    .returning();
  await checkBudgetAlerts([monthOf(tx.date)]);
  return { transaction: tx, already: false };
}

function guessCategoryFromReminder(title: string, category: string | null) {
  const t = `${title} ${category || ""}`.toLowerCase();
  if (/rent/.test(t)) return "Rent";
  if (/emi|loan/.test(t)) return "EMI/Loans";
  if (/netflix|spotify|prime|hotstar|subscription|youtube/.test(t)) return "Subscriptions";
  if (/fee|tuition|course/.test(t)) return "Education";
  if (/insurance|doctor|medic/.test(t)) return "Health";
  return "Bills";
}

/** Which occurrences of bill reminders already have a logged payment. */
export async function paidOccurrences(reminderIds: string[]) {
  if (!reminderIds.length) return new Set<string>();
  const rows = await db()
    .select({ reminderId: transactions.reminderId, occurrenceAt: transactions.occurrenceAt })
    .from(transactions)
    .where(inArray(transactions.reminderId, reminderIds));
  return new Set(rows.map((r) => `${r.reminderId}|${r.occurrenceAt?.toISOString()}`));
}

/** One-paragraph spend summary for the morning digest. */
export async function digestSpending(now = new Date()) {
  const month = fmtLocal(now, "yyyy-MM");
  const yesterday = fmtLocal(new Date(now.getTime() - 86400000), "yyyy-MM-dd");
  const [rows, b] = await Promise.all([listTransactions(month), getBudgets()]);
  // Yesterday may belong to last month on the 1st.
  const yRows = monthOf(yesterday) === month ? rows : await listTransactions(monthOf(yesterday));
  const ySpent = yRows.filter((r) => r.type === "expense" && r.date === yesterday).reduce((s, r) => s + r.amountPaise, 0);
  const s = summarize(month, rows);
  const limit = b[TOTAL_BUDGET];
  if (!s.count && !ySpent && !limit) return "";
  return `<h2 style="font-size:14px;margin:20px 0 8px;color:#374151">Spending</h2>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:4px 0;color:#6b7280">Yesterday</td><td style="text-align:right;font-weight:600">${esc(formatINR(ySpent))}</td></tr>
    <tr><td style="padding:4px 0;color:#6b7280">This month</td><td style="text-align:right;font-weight:600">${esc(formatINR(s.spent))}${limit ? ` <span style="color:#9ca3af;font-weight:400">of ${esc(formatINR(limit))}</span>` : ""}</td></tr>
  </table>${limit ? `<div style="margin-top:8px">${budgetBar(s.spent, limit)}</div>` : ""}`;
}

/** Week spend + top categories for the Sunday preview. */
export async function weeklySpending(now = new Date()) {
  const end = fmtLocal(now, "yyyy-MM-dd");
  const start = fmtLocal(new Date(now.getTime() - 6 * 86400000), "yyyy-MM-dd");
  const rows = await db()
    .select()
    .from(transactions)
    .where(and(gte(transactions.date, start), lt(transactions.date, `${end}~`), eq(transactions.type, "expense")));
  if (!rows.length) return "";
  const total = rows.reduce((s, r) => s + r.amountPaise, 0);
  const top = summarize("", rows).byCategory.slice(0, 3);
  return `<h2 style="font-size:14px;margin:20px 0 8px;color:#374151">Last 7 days: ${esc(formatINR(total))} spent</h2>
  <p style="font-size:13px;color:#6b7280;margin:0">Top: ${top.map((t) => `${esc(t.category)} ${esc(formatINR(t.amount))}`).join(" · ")}</p>`;
}

export function toCsv(rows: Transaction[]) {
  const head = ["Date", "Type", "Amount (INR)", "Category", "Note", "Merchant", "Method"];
  const q = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    head.join(","),
    ...rows.map((r) => [r.date, r.type, (r.amountPaise / 100).toFixed(2), r.category, r.note, r.merchant, r.method].map(q).join(",")),
  ].join("\n");
}

