"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { Check, Clock, Repeat, Trash2, IndianRupee } from "lucide-react";
import { api, dayKey, fmt, hideId, refreshAll, TZ, unhideId } from "./client";
import { useToast } from "./toast";
import { useSheet } from "./AddSheet";
import { SwipeRow } from "./SwipeRow";
import { categoryMeta, METHOD_LABEL, type AgendaItem, type ReminderInput, type ReminderRow, type Transaction } from "../types";
import { formatINR } from "@/lib/money";

const DOT: Record<string, string> = { high: "bg-rose-500", normal: "bg-indigo-400", low: "bg-zinc-400" };

function minutesUntilTomorrow9() {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  t.setHours(9, 0, 0, 0);
  return Math.round((t.getTime() - Date.now()) / 60000);
}

/** Build the edit form value for a stored reminder. */
export function reminderToInput(r: ReminderRow): ReminderInput {
  const d = new Date(r.dueAt);
  const fallback: ReminderInput = {
    title: r.title,
    notes: r.notes,
    date: dayKey(d),
    time: r.allDay ? null : d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }),
    recurrence: "none",
    interval: 1,
    priority: r.priority,
    category: r.category,
    amount: r.amountPaise ? r.amountPaise / 100 : null,
    leadTimes: r.leadTimes,
  };
  return { ...fallback, ...(r.input || {}) };
}

export function useReminderActions() {
  const { toast } = useToast();
  const { open } = useSheet();

  async function post(i: AgendaItem, action: string, minutes?: number) {
    return api<{ canLog?: number | null; snoozedUntil?: string }>("/api/occurrence", {
      method: "POST",
      json: { reminderId: i.reminderId, occurrenceAt: i.occurrenceAt, action, minutes },
    });
  }

  return {
    async done(i: AgendaItem) {
      const res = await post(i, "done");
      refreshAll();
      if (res.canLog) {
        toast({
          message: `Done. Log ${formatINR(res.canLog)} as paid?`,
          action: {
            label: "Log it",
            onClick: async () => {
              await post(i, "log");
              refreshAll();
              toast({ message: `${formatINR(res.canLog!)} added to expenses` });
            },
          },
          duration: 8000,
        });
      } else {
        toast({ message: `“${i.title}” done`, action: { label: "Undo", onClick: () => post(i, "undo").then(refreshAll) } });
      }
    },
    async undo(i: AgendaItem) {
      await post(i, "undo");
      refreshAll();
    },
    async snooze(i: AgendaItem, minutes: number) {
      const res = await post(i, "snooze", minutes);
      refreshAll();
      toast({ message: `Snoozed until ${res.snoozedUntil ? fmt.time.format(new Date(res.snoozedUntil)) : "later"}` });
    },
    async log(i: AgendaItem) {
      await post(i, "log");
      refreshAll();
      toast({ message: `${formatINR(i.amountPaise || 0)} added to expenses` });
    },
    async edit(id: string) {
      const { reminder } = await api<{ reminder: ReminderRow }>(`/api/reminders/${id}`);
      open({ mode: "reminder", id, value: reminderToInput(reminder) });
    },
  };
}

export function ReminderItem({ i, showDay, now }: { i: AgendaItem; showDay?: boolean; now: Date }) {
  const a = useReminderActions();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const d = new Date(i.occurrenceAt);
  const past = d < now && !i.done;
  const when = i.allDay
    ? showDay
      ? fmt.dayShort.format(d)
      : "All day"
    : showDay
      ? `${fmt.dayShort.format(d)}, ${fmt.time.format(d)}`
      : fmt.time.format(d);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  return (
    <SwipeRow
      right={i.done ? undefined : { label: "Done", icon: <Check className="h-5 w-5" />, className: "bg-emerald-500", onTrigger: () => a.done(i) }}
      left={i.done ? undefined : { label: "Snooze 1h", icon: <Clock className="h-5 w-5" />, className: "bg-indigo-500", onTrigger: () => a.snooze(i, 60) }}
    >
      <div
        className={clsx(
          "card group flex items-center gap-3 rounded-2xl px-3.5 py-3 transition hover:bg-raised",
          i.done && "opacity-55",
          i.priority === "high" && !i.done && "border-l-[3px] border-l-rose-500",
        )}
      >
        <button
          onClick={() => (i.done ? a.undo(i) : a.done(i))}
          aria-label={i.done ? "Undo" : "Mark done"}
          className={clsx(
            "grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 transition",
            i.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-[var(--subtle)] hover:border-emerald-500 hover:bg-emerald-500/10",
          )}
        >
          {i.done && <Check className="h-4 w-4" strokeWidth={3} />}
        </button>

        <button onClick={() => a.edit(i.reminderId)} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className={clsx("h-2 w-2 shrink-0 rounded-full", DOT[i.priority])} />
            <p className={clsx("truncate font-medium", i.done && "line-through")}>{i.title}</p>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
            <span className={clsx(past && "font-medium text-amber-600 dark:text-amber-400")}>{when}</span>
            {i.recurring && (
              <span className="flex items-center gap-1">
                <Repeat className="h-3 w-3" />
                {i.recurring}
              </span>
            )}
            {i.amountPaise && (
              <span className={clsx("rounded-md px-1.5 py-0.5 font-medium", i.paid ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : "bg-raised")}>
                {formatINR(i.amountPaise)}
                {i.paid ? " · paid" : ""}
              </span>
            )}
            {i.snoozedUntil && <span className="text-indigo-500">snoozed → {fmt.time.format(new Date(i.snoozedUntil))}</span>}
          </div>
        </button>

        <div className="flex shrink-0 items-center">
          {i.done && i.amountPaise && !i.paid && (
            <button onClick={() => a.log(i)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-300">
              <IndianRupee className="h-3.5 w-3.5" /> Log
            </button>
          )}
          {!i.done && (
            <div className="relative" ref={menuRef}>
              <button onClick={() => setMenu(!menu)} aria-label="Snooze" className="grid h-9 w-9 place-items-center rounded-lg text-subtle hover:bg-raised hover:text-fg">
                <Clock className="h-4 w-4" />
              </button>
              {menu && (
                <div className="animate-pop absolute right-0 top-10 z-20 w-40 overflow-hidden rounded-xl border border-line bg-[var(--bg)] py-1 shadow-2xl">
                  {(
                    [
                      ["15 minutes", 15],
                      ["1 hour", 60],
                      ["3 hours", 180],
                      ["Tomorrow 9am", minutesUntilTomorrow9()],
                    ] as const
                  ).map(([l, m]) => (
                    <button
                      key={l}
                      onClick={() => {
                        setMenu(false);
                        a.snooze(i, m);
                      }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-raised"
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </SwipeRow>
  );
}

export function TxItem({ t }: { t: Transaction }) {
  const { open } = useSheet();
  const { undoable } = useToast();
  const m = categoryMeta(t.category);
  const income = t.type === "income";

  const remove = () => {
    hideId(t.id);
    undoable(
      "Entry deleted",
      () => api(`/api/transactions/${t.id}`, { method: "DELETE" }).then(refreshAll),
      () => unhideId(t.id),
    );
  };

  return (
    <SwipeRow left={{ label: "Delete", icon: <Trash2 className="h-5 w-5" />, className: "bg-rose-500", onTrigger: remove }}>
      <button
        onClick={() =>
          open({
            mode: "expense",
            id: t.id,
            value: {
              type: t.type,
              amount: t.amountPaise / 100,
              category: t.category,
              note: t.note,
              merchant: t.merchant,
              method: t.method,
              date: t.date,
            },
          })
        }
        className="card flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition hover:bg-raised"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg" style={{ background: `${m.color}22` }}>
          {m.emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{t.note || t.category}</span>
          <span className="block truncate text-xs text-muted">
            {[t.category, t.merchant, t.method && METHOD_LABEL[t.method], t.reminderId && "from bill"].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className={clsx("shrink-0 font-semibold tabular-nums", income ? "text-emerald-500" : "text-fg")}>
          {income ? "+" : "−"}
          {formatINR(t.amountPaise)}
        </span>
      </button>
    </SwipeRow>
  );
}

export function Section({ title, right, tone, children }: { title: string; right?: React.ReactNode; tone?: "danger"; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h3 className={clsx("text-xs font-semibold uppercase tracking-wider", tone === "danger" ? "text-rose-500" : "text-subtle")}>{title}</h3>
        {right && <span className="text-xs font-medium text-muted">{right}</span>}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function Empty({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center rounded-3xl px-6 py-12 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-raised text-subtle">{icon}</div>
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-xs text-sm text-muted">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-[60px] rounded-2xl" />
      ))}
    </div>
  );
}

export function PageTitle({ title, subtitle, right }: { title: string; subtitle?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);
  return now;
}
