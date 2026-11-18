import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/** A reminder. One-off when `rrule` is null, otherwise recurring. */
export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    notes: text("notes"),
    /** First occurrence, stored in UTC. */
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    /** RRULE body without DTSTART, e.g. "FREQ=YEARLY;INTERVAL=1". */
    rrule: text("rrule"),
    priority: text("priority").notNull().default("normal"), // low | normal | high
    /** Optional bill amount in paise (rent, EMI, subscriptions). Lets "Done" log it as an expense. */
    amountPaise: integer("amount_paise"),
    category: text("category"),
    /** Minutes before each occurrence to send an alert. 0 = at the time. */
    leadTimes: integer("lead_times").array().notNull().default([0]),
    status: text("status").notNull().default("active"), // active | done | archived
    /** Bumped on every edit so old queued alerts are ignored. */
    version: integer("version").notNull().default(1),
    /** The editable input the reminder was built from. */
    input: jsonb("input"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reminders_status_idx").on(t.status)],
);

/** Every alert that has been planned for a reminder occurrence. */
export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reminderId: uuid("reminder_id")
      .notNull()
      .references(() => reminders.id, { onDelete: "cascade" }),
    occurrenceAt: timestamp("occurrence_at", { withTimezone: true }).notNull(),
    alertAt: timestamp("alert_at", { withTimezone: true }).notNull(),
    leadMinutes: integer("lead_minutes").notNull().default(0),
    kind: text("kind").notNull().default("alert"), // alert | snooze | escalation
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull().default("queued"), // queued | sending | sent | cancelled | failed
    qstashId: text("qstash_id"),
    attempts: integer("attempts").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("deliveries_dedupe_idx").on(t.dedupeKey),
    index("deliveries_status_alert_idx").on(t.status, t.alertAt),
    index("deliveries_reminder_occ_idx").on(t.reminderId, t.occurrenceAt),
  ],
);

/** Marks one occurrence of a reminder as done. */
export const completions = pgTable(
  "completions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reminderId: uuid("reminder_id")
      .notNull()
      .references(() => reminders.id, { onDelete: "cascade" }),
    occurrenceAt: timestamp("occurrence_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("completions_occ_idx").on(t.reminderId, t.occurrenceAt)],
);

/** Money in or out. Amounts are stored in paise to avoid rounding errors. */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull().default("expense"), // expense | income
    amountPaise: integer("amount_paise").notNull(),
    category: text("category").notNull().default("Other"),
    note: text("note"),
    merchant: text("merchant"),
    method: text("method"), // upi | card | cash | bank
    /** Local calendar date, YYYY-MM-DD. */
    date: text("date").notNull(),
    /** Set when logged from a bill reminder. */
    reminderId: uuid("reminder_id").references(() => reminders.id, { onDelete: "set null" }),
    occurrenceAt: timestamp("occurrence_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("transactions_date_idx").on(t.date), index("transactions_reminder_idx").on(t.reminderId, t.occurrenceAt)],
);

/** Monthly budgets. category "__total__" is the overall limit. */
export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: text("category").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("budgets_category_idx").on(t.category)],
);

/** Remembers which budget alerts were already emailed (one per month/category/threshold). */
export const budgetAlerts = pgTable(
  "budget_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    month: text("month").notNull(),
    category: text("category").notNull(),
    threshold: integer("threshold").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("budget_alerts_idx").on(t.month, t.category, t.threshold)],
);

export type Reminder = typeof reminders.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Delivery = typeof deliveries.$inferSelect;
