export type Priority = "low" | "normal" | "high";
export type Recurrence = "none" | "daily" | "weekly" | "monthly" | "yearly";
export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";
export type Method = "upi" | "card" | "cash" | "bank";

export type ReminderInput = {
  title: string;
  notes?: string | null;
  date: string;
  time?: string | null;
  recurrence: Recurrence;
  interval: number;
  weekdays?: Weekday[] | null;
  until?: string | null;
  priority: Priority;
  category?: string | null;
  amount?: number | null;
  leadTimes?: number[] | null;
};

export type TransactionInput = {
  type: "expense" | "income";
  amount: number;
  category: string;
  note?: string | null;
  merchant?: string | null;
  method?: Method | null;
  date: string;
};

export type AgendaItem = {
  reminderId: string;
  occurrenceAt: string;
  title: string;
  notes: string | null;
  priority: Priority;
  category: string | null;
  allDay: boolean;
  recurring: string;
  done: boolean;
  snoozedUntil: string | null;
  amountPaise: number | null;
  paid: boolean;
};

export type ReminderRow = {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string;
  allDay: boolean;
  rrule: string | null;
  priority: Priority;
  category: string | null;
  amountPaise: number | null;
  leadTimes: number[];
  status: string;
  input: ReminderInput | null;
  recurring: string;
};

export type Transaction = {
  id: string;
  type: "expense" | "income";
  amountPaise: number;
  category: string;
  note: string | null;
  merchant: string | null;
  method: Method | null;
  date: string;
  reminderId: string | null;
  createdAt: string;
};

export type Insights = {
  month: string;
  spent: number;
  income: number;
  byCategory: { category: string; amount: number }[];
  byDay: { date: string; amount: number }[];
  count: number;
  prevSpent: number;
  prevByCategory: { category: string; amount: number }[];
  budgets: Record<string, number>;
};

export const LEAD_OPTIONS: { min: number; label: string }[] = [
  { min: 0, label: "At time" },
  { min: 15, label: "15m" },
  { min: 60, label: "1h" },
  { min: 1440, label: "1 day" },
  { min: 2880, label: "2 days" },
  { min: 10080, label: "1 week" },
];

export const WEEKDAY_LIST: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export const EXPENSE_CATEGORIES = [
  "Food",
  "Groceries",
  "Transport",
  "Fuel",
  "Shopping",
  "Bills",
  "Rent",
  "EMI/Loans",
  "Health",
  "Entertainment",
  "Subscriptions",
  "Education",
  "Travel",
  "Family",
  "Gifts",
  "Other",
];
export const INCOME_CATEGORIES = ["Salary", "Freelance", "Refund", "Interest", "Gift", "Other"];

export const CATEGORY_META: Record<string, { emoji: string; color: string }> = {
  Food: { emoji: "🍔", color: "#f97316" },
  Groceries: { emoji: "🛒", color: "#84cc16" },
  Transport: { emoji: "🚕", color: "#eab308" },
  Fuel: { emoji: "⛽", color: "#f59e0b" },
  Shopping: { emoji: "🛍️", color: "#ec4899" },
  Bills: { emoji: "🧾", color: "#06b6d4" },
  Rent: { emoji: "🏠", color: "#8b5cf6" },
  "EMI/Loans": { emoji: "🏦", color: "#6366f1" },
  Health: { emoji: "💊", color: "#10b981" },
  Entertainment: { emoji: "🎬", color: "#f43f5e" },
  Subscriptions: { emoji: "📺", color: "#a855f7" },
  Education: { emoji: "📚", color: "#3b82f6" },
  Travel: { emoji: "✈️", color: "#14b8a6" },
  Family: { emoji: "👨‍👩‍👧", color: "#fb7185" },
  Gifts: { emoji: "🎁", color: "#d946ef" },
  Other: { emoji: "📦", color: "#94a3b8" },
  Salary: { emoji: "💼", color: "#10b981" },
  Freelance: { emoji: "💻", color: "#22c55e" },
  Refund: { emoji: "↩️", color: "#14b8a6" },
  Interest: { emoji: "📈", color: "#0ea5e9" },
  Gift: { emoji: "🎁", color: "#d946ef" },
};

const FALLBACK = ["#f97316", "#06b6d4", "#a855f7", "#84cc16", "#f43f5e", "#3b82f6", "#eab308", "#14b8a6"];
export function categoryMeta(c: string) {
  if (CATEGORY_META[c]) return CATEGORY_META[c];
  let h = 0;
  for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { emoji: "🏷️", color: FALLBACK[h % FALLBACK.length] };
}

export const METHOD_LABEL: Record<Method, string> = { upi: "UPI", card: "Card", cash: "Cash", bank: "Bank" };

export type TaskInput = {
  title: string;
  notes?: string | null;
  dueDate?: string | null;
  focus: boolean;
  priority: Priority;
};

export type Task = {
  id: string;
  title: string;
  notes: string | null;
  dueDate: string | null;
  focusDate: string | null;
  priority: Priority;
  done: boolean;
  doneAt: string | null;
  createdAt: string;
};

export type FocusTask = Task & { carried: boolean; overdue: boolean };
