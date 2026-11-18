export type Priority = "low" | "normal" | "high";
export type Recurrence = "none" | "daily" | "weekly" | "monthly" | "yearly";
export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

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
  leadTimes?: number[] | null;
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
  leadTimes: number[];
  status: string;
  input: ReminderInput | null;
  recurring: string;
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
