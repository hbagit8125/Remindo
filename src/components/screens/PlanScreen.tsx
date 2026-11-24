"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { clsx } from "clsx";
import { Bell, CalendarDays, CheckSquare, ChevronDown, ListTodo, Plus, Sun } from "lucide-react";
import { dayKey, useData, useHidden } from "@/components/app/client";
import { SwipeHint } from "@/components/app/SwipeRow";
import { Empty, PageTitle, QuickTask, ReminderItem, Section, SkeletonList, TaskItem, useNow } from "@/components/app/rows";
import { useSheet } from "@/components/app/AddSheet";
import type { AgendaItem, FocusTask, ReminderRow, Task } from "@/components/types";
import { splitAgenda } from "./HomeScreen";
import { AllReminders, DayGroups } from "./RemindersScreen";
import { CalendarView } from "./CalendarView";

type View = "today" | "calendar" | "tasks" | "reminders";
const VIEWS: { id: View; label: string; icon: typeof Sun }[] = [
  { id: "today", label: "Today", icon: Sun },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "tasks", label: "Tasks", icon: CheckSquare },
  { id: "reminders", label: "Reminders", icon: Bell },
];

export function PlanScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const view = (VIEWS.find((v) => v.id === params.get("view"))?.id || "today") as View;
  const setView = (v: View) => router.replace(v === "today" ? "/plan" : `/plan?view=${v}`, { scroll: false });
  const { open } = useSheet();

  return (
    <div>
      <PageTitle
        title="Plan"
        subtitle={<span className="md:hidden">Swipe right to finish, left to delete (or skip a repeating one)</span>}
        right={
          <button
            onClick={() => open({ mode: view === "reminders" ? "reminder" : "task" })}
            className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-raised"
          >
            <Plus className="h-4 w-4" /> {view === "reminders" ? "Reminder" : "Task"}
          </button>
        }
      />
      <nav className="no-scrollbar mb-5 flex gap-1 overflow-x-auto rounded-2xl bg-raised p-1">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={clsx(
              "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition",
              view === v.id ? "bg-surface text-fg shadow-sm ring-1 ring-line" : "text-muted hover:text-fg",
            )}
          >
            <v.icon className="h-4 w-4" />
            <span className={clsx(view !== v.id && "hidden sm:inline")}>{v.label}</span>
          </button>
        ))}
      </nav>
      {view === "today" && <TodayView />}
      {view === "calendar" && <CalendarView />}
      {view === "tasks" && <TasksView />}
      {view === "reminders" && <RemindersView />}
    </div>
  );
}

// ------------------------------------------------------------- Today

function TodayView() {
  const now = useNow();
  const hidden = useHidden();
  const agenda = useData<{ items: AgendaItem[] }>("/api/agenda?days=2");
  const tasks = useData<{ tasks: Task[]; focus: FocusTask[] }>("/api/tasks");
  const a = useMemo(() => splitAgenda(agenda.data?.items || [], now, hidden), [agenda.data, now, hidden]);
  const focus = (tasks.data?.focus || []).filter((t) => !hidden.has(t.id));
  const focusIds = new Set(focus.map((t) => t.id));
  const doneCount = focus.filter((t) => t.done).length + a.today.filter((i) => i.done).length;
  const total = focus.length + a.today.length;

  if (agenda.loading || tasks.loading) return <SkeletonList />;
  return (
    <>
      {total > 0 && <SwipeHint text="Tip: swipe a reminder right to mark it done, left to delete it (repeating ones: skip this time)." />}
      {total > 0 && (
        <div className="card mb-5 rounded-2xl p-4">
          <div className="mb-2 flex justify-between text-sm">
            <span className="font-medium">Today&apos;s progress</span>
            <span className="text-muted">
              {doneCount}/{total} done
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(doneCount / total) * 100}%` }} />
          </div>
        </div>
      )}

      {a.overdue.length > 0 && (
        <Section title="Overdue reminders" tone="danger">
          {a.overdue.map((i) => (
            <ReminderItem key={i.reminderId + i.occurrenceAt} i={i} now={now} showDay />
          ))}
        </Section>
      )}

      <Section title="Focus" right={focus.length ? `${focus.filter((t) => t.done).length}/${focus.length}` : undefined}>
        {focus.map((t) => (
          <TaskItem key={t.id} t={t} focused={focusIds.has(t.id) && Boolean(t.focusDate)} tag={t.carried ? "carried over" : undefined} />
        ))}
        <QuickTask />
      </Section>

      <Section title="Reminders today">
        {a.today.length ? (
          a.today.map((i) => <ReminderItem key={i.reminderId + i.occurrenceAt} i={i} now={now} />)
        ) : (
          <div className="card rounded-2xl px-4 py-5 text-center text-sm text-muted">No reminders today</div>
        )}
      </Section>
    </>
  );
}

// ------------------------------------------------------------- Tasks

function TasksView() {
  const hidden = useHidden();
  const { data, loading } = useData<{ tasks: Task[]; focus: FocusTask[] }>("/api/tasks");
  const [showDone, setShowDone] = useState(false);
  if (loading) return <SkeletonList />;
  const all = (data?.tasks || []).filter((t) => !hidden.has(t.id));
  const today = dayKey(new Date());
  const focused = (t: Task) => Boolean(t.focusDate && t.focusDate <= today);
  const open = all.filter((t) => !t.done);
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  const dueToday = open.filter((t) => t.dueDate === today);
  const upcoming = open.filter((t) => t.dueDate && t.dueDate > today).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  const someday = open.filter((t) => !t.dueDate);
  const done = all.filter((t) => t.done).sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || ""));
  const list = (ts: Task[]) => ts.map((t) => <TaskItem key={t.id} t={t} focused={focused(t)} />);

  return (
    <>
      <div className="mb-5">
        <QuickTask focus={false} placeholder="Add a task…" />
      </div>
      {!open.length && !done.length && (
        <Empty icon={<ListTodo className="h-6 w-6" />} title="No tasks yet" text="Add to-dos without a time: “Buy milk”, “Finish report by Friday”. Star one to put it in today's focus." />
      )}
      {overdue.length > 0 && (
        <Section title="Overdue" tone="danger">
          {list(overdue)}
        </Section>
      )}
      {dueToday.length > 0 && <Section title="Due today">{list(dueToday)}</Section>}
      {upcoming.length > 0 && <Section title="Upcoming">{list(upcoming)}</Section>}
      {someday.length > 0 && <Section title="No date">{list(someday)}</Section>}
      {done.length > 0 && (
        <section>
          <button onClick={() => setShowDone(!showDone)} className="mb-2 flex items-center gap-1 px-1 text-xs font-semibold uppercase tracking-wider text-subtle">
            Done this week · {done.length}
            <ChevronDown className={clsx("h-3.5 w-3.5 transition", showDone && "rotate-180")} />
          </button>
          {showDone && <div className="space-y-2">{list(done)}</div>}
        </section>
      )}
    </>
  );
}

// ------------------------------------------------------------- Reminders

function RemindersView() {
  const now = useNow();
  const hidden = useHidden();
  const [sub, setSub] = useState<"upcoming" | "important" | "all">("upcoming");
  const agenda = useData<{ items: AgendaItem[] }>("/api/agenda?days=120");
  const all = useData<{ reminders: ReminderRow[] }>("/api/reminders");
  const a = useMemo(() => splitAgenda(agenda.data?.items || [], now, hidden), [agenda.data, now, hidden]);
  const rows = (all.data?.reminders || []).filter((r) => !hidden.has(r.id));
  const chips = [
    ["upcoming", "Upcoming"],
    ["important", "Important"],
    ["all", "All"],
  ] as const;
  return (
    <>
      <div className="mb-4 flex gap-1.5">
        {chips.map(([id, l]) => (
          <button
            key={id}
            onClick={() => setSub(id)}
            className={clsx("rounded-full border px-3 py-1.5 text-xs font-medium", sub === id ? "border-fg bg-fg text-[var(--bg)]" : "border-line text-muted")}
          >
            {l}
            {id === "important" && a.important.length ? ` · ${new Set(a.important.map((i) => i.reminderId)).size}` : ""}
          </button>
        ))}
      </div>
      {agenda.loading ? (
        <SkeletonList />
      ) : sub === "all" ? (
        <AllReminders rows={rows} />
      ) : (
        <DayGroups list={sub === "upcoming" ? [...a.today.filter((i) => !i.done && new Date(i.occurrenceAt) > now), ...a.upcoming] : a.important} now={now} />
      )}
    </>
  );
}
