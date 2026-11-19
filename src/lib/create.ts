import { db, reminders, transactions } from "@/db";
import { inputToRow, type ReminderInput } from "./reminder-input";
import { planAndQueue } from "./scheduler";
import { checkBudgetAlerts, inputToTxRow, monthOf } from "./finance";
import type { TransactionInput } from "./money";

/** Save reminders and queue any alerts due in the next 48h. */
export async function createReminders(items: ReminderInput[]) {
  if (!items.length) return [];
  const created = await db().insert(reminders).values(items.map(inputToRow)).returning();
  await planAndQueue({ reminderIds: created.map((r) => r.id) }).catch(() => null);
  return created;
}

/** Save expenses/income and check budgets. */
export async function createTransactions(items: TransactionInput[]) {
  if (!items.length) return [];
  const created = await db().insert(transactions).values(items.map(inputToTxRow)).returning();
  await checkBudgetAlerts(created.filter((t) => t.type === "expense").map((t) => monthOf(t.date))).catch(() => null);
  return created;
}
