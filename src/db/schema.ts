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

export type Reminder = typeof reminders.$inferSelect;
export type Delivery = typeof deliveries.$inferSelect;
