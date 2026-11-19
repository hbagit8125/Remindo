"use client";

import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { dayKey, relativeDay, useData, useHidden } from "@/components/app/client";
import { ReminderItem, Section, TaskItem, TxItem, useNow } from "@/components/app/rows";
import type { AgendaItem, Task, Transaction } from "@/components/types";
import { formatINR } from "@/lib/money";

type Day = { reminders: AgendaItem[]; tasks: Task[]; transactions: Transaction[]; spent: number; income: number };
type CalRes = { from: string; to: string; days: Record<string, Day> };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Dates are handled as YYYY-MM-DD strings at noon UTC to avoid timezone slips. */
const d = (s: string) => new Date(`${s}T12:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(d(s).getTime() + n * 86400000));
const mondayOf = (s: string) => addDays(s, -((d(s).getUTCDay() + 6) % 7));

/** Short ₹ for small cells: ₹850, ₹1.2k, ₹15k, ₹1.5L */
function shortINR(paise: number) {
  const r = paise / 100;
  if (r >= 100000) return `₹${(r / 100000).toFixed(r >= 1000000 ? 0 : 1)}L`;
  if (r >= 1000) return `₹${(r / 1000).toFixed(r >= 10000 ? 0 : 1)}k`;
  return `₹${Math.round(r)}`;
}

export function CalendarView() {
  const now = useNow();
  const hidden = useHidden();
  const today = dayKey(now);
  const [mode, setMode] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);

  const { from, to, cells, title } = useMemo(() => {
    if (mode === "week") {
      const from = mondayOf(anchor);
      const cells = Array.from({ length: 7 }, (_, i) => addDays(from, i));
      const f = d(from);
      const t = d(cells[6]);
      const fmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
      return { from, to: cells[6], cells, title: `${fmt.format(f)} – ${fmt.format(t)}` };
    }
    const first = `${anchor.slice(0, 7)}-01`;
    const from = mondayOf(first);
    const cells = Array.from({ length: 42 }, (_, i) => addDays(from, i));
    // Drop a trailing week that's entirely next month.
    const trimmed = cells[35].slice(0, 7) !== anchor.slice(0, 7) ? cells.slice(0, 35) : cells;
    const title = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(d(first));
    return { from, to: trimmed[trimmed.length - 1], cells: trimmed, title };
  }, [mode, anchor]);

  const { data } = useData<CalRes>(`/api/calendar?from=${from}&to=${to}`);
  const days = data?.days || {};
  const dayData = (k: string): Day => {
    const x = days[k] || { reminders: [], tasks: [], transactions: [], spent: 0, income: 0 };
    return {
      ...x,
      reminders: x.reminders.filter((r) => !hidden.has(r.reminderId)),
      tasks: x.tasks.filter((t) => !hidden.has(t.id)),
      transactions: x.transactions.filter((t) => !hidden.has(t.id)),
    };
  };
  const sel = dayData(selected);
  const monthTotal = cells.filter((c) => mode === "week" || c.slice(0, 7) === anchor.slice(0, 7)).reduce((s, c) => s + (days[c]?.spent || 0), 0);

  const shift = (n: number) => {
    const next = mode === "week" ? addDays(anchor, 7 * n) : (() => {
      const [y, m] = anchor.split("-").map(Number);
      const x = new Date(Date.UTC(y, m - 1 + n, 1, 12));
      return iso(x);
    })();
    setAnchor(next);
    setSelected(next.slice(0, 7) === today.slice(0, 7) || (mode === "week" && cells.includes(today)) ? today : mode === "week" ? mondayOf(next) : next);
  };

  return (
    <div className="md:grid md:grid-cols-5 md:gap-6">
      <div className="md:col-span-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button onClick={() => shift(-1)} aria-label="Previous" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-raised">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[8.5rem] text-center text-sm font-semibold">{title}</span>
            <button onClick={() => shift(1)} aria-label="Next" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-raised">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="flex rounded-lg bg-raised p-0.5 text-xs font-medium">
            {(["month", "week"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={clsx("rounded-md px-2.5 py-1.5 capitalize", mode === m ? "bg-surface shadow-sm ring-1 ring-line" : "text-muted")}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="card overflow-hidden rounded-3xl p-2">
          <div className="grid grid-cols-7 pb-1 text-center text-[11px] font-medium uppercase tracking-wide text-subtle">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-1.5">
                {w.slice(0, mode === "week" ? 3 : 1)}
                <span className="hidden sm:inline">{mode === "week" ? "" : w.slice(1)}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((c) => {
              const x = dayData(c);
              const inMonth = mode === "week" || c.slice(0, 7) === anchor.slice(0, 7);
              const isToday = c === today;
              const isSel = c === selected;
              const pending = x.reminders.filter((r) => !r.done).length + x.tasks.filter((t) => !t.done).length;
              const important = x.reminders.some((r) => r.priority === "high" && !r.done);
              return (
                <button
                  key={c}
                  onClick={() => setSelected(c)}
                  className={clsx(
                    "flex flex-col items-center rounded-xl px-0.5 py-1.5 transition",
                    mode === "week" ? "min-h-24" : "min-h-[62px]",
                    isSel ? "bg-indigo-500/15 ring-1 ring-indigo-400" : "hover:bg-raised",
                    !inMonth && "opacity-35",
                  )}
                >
                  <span
                    className={clsx(
                      "grid h-7 w-7 place-items-center rounded-full text-sm",
                      isToday ? "bg-indigo-500 font-semibold text-white" : "font-medium",
                    )}
                  >
                    {Number(c.slice(8))}
                  </span>
                  <span className="mt-1 flex h-1.5 gap-0.5">
                    {important && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />}
                    {pending > 0 && <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />}
                    {pending > 2 && <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />}
                    {x.tasks.length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
                  </span>
                  {x.spent > 0 && <span className="mt-0.5 text-[10px] font-medium tabular-nums text-muted">{shortINR(x.spent)}</span>}
                  {mode === "week" && x.reminders.length + x.tasks.length > 0 && (
                    <span className="mt-1 text-[10px] text-subtle">{x.reminders.length + x.tasks.length} items</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line px-2 pt-2 text-[11px] text-muted">
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" /> reminders
              </span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> tasks
              </span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> important
              </span>
            </span>
            <span>
              {mode === "week" ? "Week" : "Month"} spend <b className="text-fg">{formatINR(monthTotal)}</b>
            </span>
          </div>
        </div>
      </div>

      <div className="mt-6 md:col-span-2 md:mt-0">
        <div className="mb-3 flex items-baseline justify-between px-1">
          <h3 className="text-lg font-semibold">{relativeDay(selected, now)}</h3>
          {(sel.spent > 0 || sel.income > 0) && (
            <span className="text-sm text-muted">
              {formatINR(sel.spent)} spent{sel.income ? ` · +${formatINR(sel.income)}` : ""}
            </span>
          )}
        </div>
        {!sel.reminders.length && !sel.tasks.length && !sel.transactions.length ? (
          <div className="card rounded-2xl px-4 py-8 text-center text-sm text-muted">Nothing on this day</div>
        ) : (
          <>
            {sel.reminders.length > 0 && (
              <Section title="Reminders">
                {sel.reminders.map((i) => (
                  <ReminderItem key={i.reminderId + i.occurrenceAt} i={i} now={now} />
                ))}
              </Section>
            )}
            {sel.tasks.length > 0 && (
              <Section title="Tasks due">
                {sel.tasks.map((t) => (
                  <TaskItem key={t.id} t={t} focused={Boolean(t.focusDate && t.focusDate <= today)} />
                ))}
              </Section>
            )}
            {sel.transactions.length > 0 && (
              <Section title="Money">
                {sel.transactions.map((t) => (
                  <TxItem key={t.id} t={t} />
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
