import { db, reminders, transactions, type Reminder, type Transaction } from "@/db";
import { inputToRow, type ReminderInput } from "./reminder-input";
import { planAndQueue } from "./scheduler";
import { checkBudgetAlerts, inputToTxRow, monthOf } from "./finance";
import type { TransactionInput } from "./money";
import { addedTitle, money, recorded, removed, snapReminder } from "./undo";
import { eq, inArray } from "drizzle-orm";
import { cancelQueued } from "./scheduler";

/** Save reminders and queue any alerts due in the next 48h. */
export async function createReminders(items: ReminderInput[]) {
  if (!items.length) return [];
  return recorded({ title: (c: Reminder[]) => addedTitle("reminder", c.map((r) => r.title)), kind: "add" }, async (rec) => {
    const created = await db().insert(reminders).values(items.map(inputToRow)).returning();
    rec(removed("reminders", created.map((r) => r.id)));
    await planAndQueue({ reminderIds: created.map((r) => r.id) }).catch(() => null);
    return created;
  });
}

/** Delete reminders (Undo brings them back with their history). */
export async function deleteReminders(ids: string[]) {
  if (!ids.length) return [];
  const rows = await db().select().from(reminders).where(inArray(reminders.id, ids));
  return recorded({ title: rows.length === 1 ? `Deleted “${rows[0]?.title}”` : `Deleted ${rows.length} reminders`, kind: "delete" }, async (rec) => {
    for (const r of rows) {
      rec(await snapReminder(r.id));
      await cancelQueued(r.id);
      await db().delete(reminders).where(eq(reminders.id, r.id));
    }
    return rows;
  });
}

/** Save expenses/income and check budgets. */
export async function createTransactions(items: TransactionInput[]) {
  if (!items.length) return [];
  const { normalizeCategory } = await import("./categories");
  const fixed = await Promise.all(items.map(async (t) => ({ ...t, category: await normalizeCategory(t.category, t.type) })));
  return recorded(
    {
      title: (c: Transaction[]) =>
        c.length === 1 ? `Added ${c[0].type === "income" ? "income" : c[0].type === "transfer" ? "transfer" : "expense"} ${money(c[0].amountPaise)} · ${c[0].note || c[0].category}` : `Added ${c.length} entries`,
      kind: "add",
    },
    async (rec) => {
      const created = await db().insert(transactions).values(fixed.map(inputToTxRow)).returning();
      rec(removed("transactions", created.map((t) => t.id)));
      await checkBudgetAlerts(created.filter((t) => t.type === "expense").map((t) => monthOf(t.date))).catch(() => null);
      return created;
    },
  );
}
