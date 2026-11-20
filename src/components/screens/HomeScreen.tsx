"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { AlertTriangle, ArrowRight, Bell, SlidersHorizontal, Sparkles, Star, Wallet } from "lucide-react";
import { ComingUp, CustomiseHome, useHomeLayout, type WidgetId } from "@/components/app/HomeWidgets";
import { dayKey, fmt, greeting, useData, useHidden } from "@/components/app/client";
import { Empty, QuickTask, ReminderItem, Section, SkeletonList, TaskItem, TxItem, useNow } from "@/components/app/rows";
import { useSheet } from "@/components/app/AddSheet";
import { FavouritesStrip } from "@/components/app/FavouritesStrip";
import { SuggestionCards } from "@/components/app/SuggestionCards";
import type { AgendaItem, FocusTask, Transaction } from "@/components/types";
import { formatINR, TOTAL_BUDGET } from "@/lib/money";

const OWNER = process.env.NEXT_PUBLIC_OWNER_NAME ?? "Hashir";

export function splitAgenda(items: AgendaItem[], now: Date, hidden: Set<string>) {
  const todayKey = dayKey(now);
  const overdue: AgendaItem[] = [];
  const today: AgendaItem[] = [];
  const upcoming: AgendaItem[] = [];
  for (const i of items) {
    if (hidden.has(i.reminderId)) continue;
    const d = new Date(i.occurrenceAt);
    if (dayKey(d) === todayKey) today.push(i);
    else if (d < now) {
      if (!i.done) overdue.push(i);
    } else upcoming.push(i);
  }
  return { overdue, today, upcoming, important: upcoming.filter((i) => i.priority === "high" && !i.done) };
}

export function BudgetBar({ spent, limit, className }: { spent: number; limit: number; className?: string }) {
  const pct = Math.min(100, (spent / limit) * 100);
  const color = pct >= 100 ? "bg-rose-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className={clsx("h-2 overflow-hidden rounded-full bg-raised", className)}>
      <div className={clsx("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function HomeScreen() {
  const now = useNow();
  const hidden = useHidden();
  const { open } = useSheet();
  const agenda = useData<{ items: AgendaItem[] }>("/api/agenda?days=30");
  const money = useData<{ transactions: Transaction[] }>("/api/transactions");
  const budgets = useData<{ budgets: Record<string, number> }>("/api/budgets");
  const taskData = useData<{ focus: FocusTask[] }>("/api/tasks");
  const focus = (taskData.data?.focus || []).filter((t) => !hidden.has(t.id));
  const focusLeft = focus.filter((t) => !t.done).length;

  const a = useMemo(() => splitAgenda(agenda.data?.items || [], now, hidden), [agenda.data, now, hidden]);
  const tx = (money.data?.transactions || []).filter((t) => !hidden.has(t.id));
  const todayKey = dayKey(now);
  const spentToday = tx.filter((t) => t.type === "expense" && t.date === todayKey).reduce((s, t) => s + t.amountPaise, 0);
  const spentMonth = tx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amountPaise, 0);
  const limit = budgets.data?.budgets[TOTAL_BUDGET];
  const pendingToday = a.today.filter((i) => !i.done);
  const nextUp = [...a.overdue, ...pendingToday].slice(0, 6);
  const loading = agenda.loading || money.loading;
  const brandNew = !loading && !agenda.data?.items.length && !tx.length && !taskData.data?.focus.length;
  const { layout, saveLayout } = useHomeLayout();
  const [customising, setCustomising] = useState(false);

  const widgets: Record<WidgetId, () => React.ReactNode> = {
    summary: () => (
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <Link href="/plan" className="card rounded-3xl p-4 transition hover:bg-raised">
          <div className="flex items-center gap-2 text-xs font-medium text-muted">
            <Bell className="h-4 w-4 text-indigo-500" /> Today
          </div>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{loading ? "–" : pendingToday.length + focusLeft}</p>
          <p className="text-xs text-muted">
            {pendingToday.length} reminder{pendingToday.length === 1 ? "" : "s"} · {focusLeft} task{focusLeft === 1 ? "" : "s"} left
          </p>
        </Link>
        <Link href="/expenses" className="card rounded-3xl p-4 transition hover:bg-raised">
          <div className="flex items-center gap-2 text-xs font-medium text-muted">
            <Wallet className="h-4 w-4 text-emerald-500" /> Spent today
          </div>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{loading ? "–" : formatINR(spentToday)}</p>
          <p className="text-xs text-muted">
              {(() => {
                const n = tx.filter((t) => t.date === todayKey && t.type === "expense").length;
                return `${n} ${n === 1 ? "expense" : "expenses"}`;
              })()}
            </p>
        </Link>
        <Link href={limit ? "/insights" : "/insights?budget=1"} className="card col-span-2 rounded-3xl p-4 transition hover:bg-raised md:col-span-1">
          <div className="flex items-center justify-between text-xs font-medium text-muted">
            <span>This month</span>
            {limit ? <span>{Math.round((spentMonth / limit) * 100)}% of budget</span> : <span className="text-indigo-500">Set budget →</span>}
          </div>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{loading ? "–" : formatINR(spentMonth)}</p>
          {limit ? (
            <>
              <BudgetBar spent={spentMonth} limit={limit} className="mt-2" />
              <p className="mt-1.5 text-xs text-muted">
                {spentMonth <= limit ? `${formatINR(limit - spentMonth)} left` : `${formatINR(spentMonth - limit)} over`}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted">spent so far</p>
          )}
        </Link>
      </div>
    ),
    favourites: () => <FavouritesStrip />,
    suggestions: () => <SuggestionCards />,
    overdue: () =>
      a.overdue.length > 0 && (
        <Link
          href="/plan"
          className="mb-6 flex items-center gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            {a.overdue.length} overdue reminder{a.overdue.length > 1 ? "s" : ""}. Tick them off or snooze them.
          </span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      ),
    focus: () => (
      <Section title="Today's focus" right={<Link href="/plan?view=tasks">All tasks</Link>}>
        {focus.map((t) => (
          <TaskItem key={t.id} t={t} focused={Boolean(t.focusDate)} tag={t.carried ? "carried over" : undefined} />
        ))}
        <QuickTask />
      </Section>
    ),
    next: () => (
      <Section title="Next up" right={<Link href="/plan">See all</Link>}>
        {loading ? (
          <SkeletonList rows={3} />
        ) : nextUp.length ? (
          nextUp.map((i) => <ReminderItem key={i.reminderId + i.occurrenceAt} i={i} now={now} showDay={!a.today.includes(i)} />)
        ) : (
          <div className="card rounded-2xl px-4 py-6 text-center text-sm text-muted">All clear for today 🎉</div>
        )}
      </Section>
    ),
    important: () =>
      a.important.length > 0 ? (
        <Section title="Important dates ahead">
          {a.important.slice(0, 3).map((i) => (
            <ReminderItem key={i.reminderId + i.occurrenceAt} i={i} now={now} showDay />
          ))}
        </Section>
      ) : (
        !loading && (
          <div className="card mb-6 flex items-center gap-3 rounded-2xl p-4 text-sm text-muted">
            <Star className="h-5 w-5 shrink-0 text-amber-500" />
            Mark birthdays, bills and deadlines as High so you get a week&apos;s warning.
          </div>
        )
      ),
    life: () => <ComingUp />,
    spending: () => (
      <Section title="Recent spending" right={<Link href="/expenses">See all</Link>}>
        {loading ? (
          <SkeletonList rows={3} />
        ) : tx.length ? (
          tx.slice(0, 5).map((t) => <TxItem key={t.id} t={t} />)
        ) : (
          <button onClick={() => open({ mode: "expense" })} className="card w-full rounded-2xl px-4 py-6 text-center text-sm text-muted hover:bg-raised">
            No spending logged this month. <span className="text-indigo-500">Add one</span>
          </button>
        )}
      </Section>
    ),
  };

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{greeting(now)}{OWNER ? `, ${OWNER}` : ""}</h1>
        <p className="mt-0.5 text-sm text-muted">{fmt.dayLong.format(now)}</p>
      </div>

      {brandNew ? (
        <Empty
          icon={<Sparkles className="h-6 w-6" />}
          title="Let's get you set up"
          text="Tap + and say things like “Spent 450 on lunch” or “Pay rent on the 5th every month”."
          action={
            <button onClick={() => open({ mode: "ask" })} className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-2.5 text-sm font-semibold text-white">
              Add your first one
            </button>
          }
        />
      ) : (
        layout.filter((w) => !w.hidden).map((w) => <div key={w.id}>{widgets[w.id as WidgetId]?.()}</div>)
      )}

      <div className="mt-2 flex justify-center">
        <button onClick={() => setCustomising(true)} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:bg-raised hover:text-fg">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Customise Home
        </button>
      </div>
      {customising && <CustomiseHome layout={layout} onClose={() => setCustomising(false)} onSave={saveLayout} />}
    </div>
  );
}
