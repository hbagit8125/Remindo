import {
  bigint,
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
    /** Link to what created it, e.g. { kind: "medicine", id } so taking a dose lowers the stock. */
    meta: jsonb("meta"),
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
    /** Push/Telegram were held back by quiet hours (email still went). Shown in the morning digest. */
    held: boolean("held").notNull().default(false),
    qstashId: text("qstash_id"),
    /** The Telegram message for this alert, so it can be updated when you tick it off elsewhere. */
    tgChatId: bigint("tg_chat_id", { mode: "number" }),
    tgMessageId: integer("tg_message_id"),
    /** A phone notification was shown for this alert. */
    pushed: boolean("pushed").notNull().default(false),
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
    /** Which account/wallet the money came from or went to (optional). */
    accountId: uuid("account_id"),
    /** For type "transfer": the account money moved into. */
    toAccountId: uuid("to_account_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("transactions_date_idx").on(t.date), index("transactions_reminder_idx").on(t.reminderId, t.occurrenceAt)],
);

/** Bank accounts, cards, cash, wallets. Balance = opening + money in − money out. */
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("bank"), // bank | card | cash | wallet
  openingBalancePaise: integer("opening_balance_paise").notNull().default(0),
  // Credit cards: limit, the day the bill is generated, the day it must be paid, where you pay it from,
  // and the monthly "Pay the bill" reminder.
  creditLimitPaise: integer("credit_limit_paise"),
  /** Cards from the same bank often share one limit: the card whose limit this one uses. */
  sharedLimitId: uuid("shared_limit_id"),
  statementDay: integer("statement_day"),
  dueDay: integer("due_day"),
  payFromId: uuid("pay_from_id"),
  reminderId: uuid("reminder_id"),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Account = typeof accounts.$inferSelect;

/** One-tap entries like "Chai ₹20". payload is a TransactionInput without the date. */
export const favourites = pgTable("favourites", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  payload: jsonb("payload").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Money owed between you and someone ("Arun owes 600"). */
export const dues = pgTable("dues", {
  id: uuid("id").primaryKey().defaultRandom(),
  person: text("person").notNull(),
  direction: text("direction").notNull(), // they_owe | i_owe
  amountPaise: integer("amount_paise").notNull(),
  note: text("note"),
  transactionId: uuid("transaction_id"),
  reminderId: uuid("reminder_id"),
  /** Set when this due is someone's share of a split bill. */
  splitId: uuid("split_id"),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A split bill. Each other person's share is a row in `dues` (they owe you, or you owe
 * whoever paid), so balances, reminders and "paid back" work the same as plain dues.
 */
export const splits = pgTable("splits", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  totalPaise: integer("total_paise").notNull(),
  category: text("category").notNull().default("Other"),
  date: text("date").notNull(),
  /** "me", or the friend's name. */
  paidBy: text("paid_by").notNull().default("me"),
  method: text("method").notNull().default("equal"), // equal | amount | percent | shares
  /** Everyone's share as entered: [{ person, value, sharePaise }] ("me" for you). */
  shares: jsonb("shares").$type<{ person: string; value: number; sharePaise: number }[]>().notNull(),
  myPaise: integer("my_paise").notNull().default(0),
  /** The expense: the full bill when you paid, your share when a friend paid. */
  transactionId: uuid("transaction_id"),
  accountId: uuid("account_id"),
  reminderId: uuid("reminder_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Saved groups of people to split with ("Flatmates"). */
export const splitGroups = pgTable("split_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  members: text("members").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Savings goals and the money put towards them. */
export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  emoji: text("emoji"),
  targetPaise: integer("target_paise").notNull(),
  deadline: text("deadline"),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const goalContributions = pgTable("goal_contributions", {
  id: uuid("id").primaryKey().defaultRandom(),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  amountPaise: integer("amount_paise").notNull(),
  date: text("date").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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

/** App settings as key → JSON value (quiet hours, channels, Telegram link, VAPID keys…). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Browsers/phones that allowed push notifications. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("push_endpoint_idx").on(t.endpoint)],
);

/** Things parsed from a Telegram message, waiting for the Save button. */
export const telegramDrafts = pgTable("telegram_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** To-dos without a time. focusDate puts a task in that day's "Today" focus list. */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    notes: text("notes"),
    /** Optional deadline, local YYYY-MM-DD. */
    dueDate: text("due_date"),
    /** Day the task was starred for focus, local YYYY-MM-DD. Unfinished ones carry over. */
    focusDate: text("focus_date"),
    priority: text("priority").notNull().default("normal"),
    done: boolean("done").notNull().default(false),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tasks_done_idx").on(t.done), index("tasks_due_idx").on(t.dueDate)],
);

export type Reminder = typeof reminders.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Delivery = typeof deliveries.$inferSelect;

/** Things that expire: insurance, PUC, licence, passport… Each has a linked renewal reminder. */
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull().default("other"),
  name: text("name").notNull(),
  number: text("number"),
  expiryDate: text("expiry_date").notNull(),
  renewalCostPaise: integer("renewal_cost_paise"),
  notes: text("notes"),
  reminderId: uuid("reminder_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** People you care about: birthdays, anniversaries, gift ideas. Dates are "MM-DD". */
export const people = pgTable("people", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  relation: text("relation"),
  birthday: text("birthday"),
  birthYear: integer("birth_year"),
  anniversary: text("anniversary"),
  giftBudgetPaise: integer("gift_budget_paise"),
  giftIdeas: text("gift_ideas"),
  notes: text("notes"),
  birthdayReminderId: uuid("birthday_reminder_id"),
  anniversaryReminderId: uuid("anniversary_reminder_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Medicines with dose times and a tablet count that drops as you take doses. */
export const medicines = pgTable("medicines", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  dose: text("dose"),
  times: text("times").array().notNull().default([]),
  stock: integer("stock"),
  perDose: integer("per_dose").notNull().default(1),
  refillAt: integer("refill_at").notNull().default(5),
  refillAlertSentAt: timestamp("refill_alert_sent_at", { withTimezone: true }),
  reminderIds: uuid("reminder_ids").array().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Checklists (shopping, packing) and free-text notes. */
export const lists = pgTable("lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  emoji: text("emoji"),
  kind: text("kind").notNull().default("list"), // list | note
  body: text("body"),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const listItems = pgTable(
  "list_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    done: boolean("done").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("list_items_list_idx").on(t.listId)],
);
export type Split = typeof splits.$inferSelect;
export type Due = typeof dues.$inferSelect;

/**
 * Everything you did, newest first, with what's needed to put it back ("Undo").
 * `ops` is a list of steps (restore a row, remove a row, un-tick a reminder…) run in order.
 * Kept for 30 days.
 */
export const activity = pgTable(
  "activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    via: text("via").notNull().default("app"),
    ops: jsonb("ops").notNull(),
    /** What it was about, e.g. "done:<reminderId>:<time>", so undoing it another way marks it undone here too. */
    ref: text("ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [index("activity_created_idx").on(t.createdAt), index("activity_ref_idx").on(t.ref)],
);
export type Activity = typeof activity.$inferSelect;

/**
 * Savings & investments: FDs, RDs, mutual funds, stocks, gold, PPF… Each has a history of money put in,
 * taken out, and growth (interest, profit, dividends; negative = a loss). Value = in − out + growth.
 */
export const savings = pgTable("savings", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("other"),
  institution: text("institution"),
  /** % a year, for FDs/RDs (shown only). */
  ratePct: text("rate_pct"),
  /** FD/RD maturity: a reminder a week before and on the day. */
  maturityDate: text("maturity_date"),
  reminderId: uuid("reminder_id"),
  notes: text("notes"),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Saving = typeof savings.$inferSelect;

export const savingEntries = pgTable(
  "saving_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    savingId: uuid("saving_id").notNull(),
    /** deposit | withdraw | growth (interest/profit; negative = loss) */
    type: text("type").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    date: text("date").notNull(),
    note: text("note"),
    /** The bank transfer this deposit/withdrawal made, if you picked an account. */
    transactionId: uuid("transaction_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("saving_entries_saving_idx").on(t.savingId)],
);
export type SavingEntry = typeof savingEntries.$inferSelect;

/**
 * Automatic monthly payments: SIPs (bank → a saving) and EMIs (loan repayments, counted as spending).
 * On the day, the payment is recorded from the chosen account by itself; if that account looks short
 * the day before, you get a reminder.
 */
export const autopays = pgTable("autopays", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** sip | emi */
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  amountPaise: integer("amount_paise").notNull(),
  /** Day of the month (31 = last day in shorter months). */
  day: integer("day").notNull(),
  accountId: uuid("account_id"),
  /** SIP: the saving it goes into. */
  savingId: uuid("saving_id"),
  /** First payment date (yyyy-MM-dd). Nothing before this, or before it was added, is recorded. */
  startDate: text("start_date").notNull(),
  /** EMI: total number of EMIs, how many were paid before you added it, the loan amount and lender. */
  totalCount: integer("total_count"),
  paidBefore: integer("paid_before").notNull().default(0),
  loanPaise: integer("loan_paise"),
  lender: text("lender"),
  active: boolean("active").notNull().default(true),
  /** The low-balance reminder for the next payment, if one was made. */
  alertReminderId: uuid("alert_reminder_id"),
  alertFor: text("alert_for"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Autopay = typeof autopays.$inferSelect;

export const autopayRuns = pgTable(
  "autopay_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    autopayId: uuid("autopay_id").notNull(),
    dueDate: text("due_date").notNull(),
    transactionId: uuid("transaction_id"),
    savingEntryId: uuid("saving_entry_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("autopay_runs_once").on(t.autopayId, t.dueDate)],
);
