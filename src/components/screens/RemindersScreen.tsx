"use client";

import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { Bell, CalendarDays, Clock, ListTodo, Plus, Repeat, Star } from "lucide-react";
import { fmt, useData, useHidden } from "@/components/app/client";
import { Empty, PageTitle, ReminderItem, Section, SkeletonList, useNow, useReminderActions } from "@/components/app/rows";
import { useSheet } from "@/components/app/AddSheet";
import type { AgendaItem, ReminderRow } from "@/components/types";
import { formatINR } from "@/lib/money";
import { splitAgenda } from "./HomeScreen";

type Tab = "today" | "upcoming" | "important" | "all";

export function RemindersScreen() {
  const now = useNow();
  const hidden = useHidden();
  const { open } = useSheet();
  const [tab, setTab] = useState<Tab>("today");
  const agenda = useData<{ items: AgendaItem[] }>("/api/agenda?days=120");
  const all = useData<{ reminders: ReminderRow[] }>("/api/reminders");
  const a = useMemo(() => splitAgenda(agenda.data?.items || [], now, hidden), [agenda.data, now, hidden]);
  const rows = (all.data?.reminders || []).filter((r) => !hidden.has(r.id));

  const tabs: { id: Tab; label: string; icon: typeof Clock; count?: number }[] = [
    { id: "today", label: "Today", icon: Clock, count: a.today.filter((i) => !i.done).length + a.overdue.length },
    { id: "upcoming", label: "Upcoming", icon: CalendarDays },
    { id: "important", label: "Important", icon: Star, count: a.important.length },
    { id: "all", label: "All", icon: ListTodo },
  ];

  return (
    <div>
      <PageTitle
        title="Reminders"
        subtitle={<span className="md:hidden">Swipe right to finish, left to snooze</span>}
        right={
          <button
            onClick={() => open({ mode: "reminder" })}
            className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-raised"
          >
            <Plus className="h-4 w-4" /> New
          </button>
        }
      />

      <nav className="no-scrollbar mb-5 flex gap-1 overflow-x-auto rounded-2xl bg-raised p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition",
              tab === t.id ? "bg-surface text-fg shadow-sm ring-1 ring-line" : "text-muted hover:text-fg",
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
            {!!t.count && <span className="rounded-full bg-indigo-500/15 px-1.5 text-[11px] leading-5 text-indigo-600 dark:text-indigo-300">{t.count}</span>}
          </button>
        ))}
      </nav>

      {agenda.loading ? (
        <SkeletonList />
      ) : tab === "all" ? (
        <AllReminders rows={rows} />
      ) : tab === "today" ? (
        <>
          {a.overdue.length > 0 && (
            <Section title="Overdue" tone="danger">
              {a.overdue.map((i) => (
                <ReminderItem key={i.reminderId + i.occurrenceAt} i={i} now={now} showDay />
              ))}
            </Section>
          )}
          {a.today.length ? (
            <Section title="Today" right={`${a.today.filter((i) => i.done).length}/${a.today.length} done`}>
              {a.today.map((i) => (
                <ReminderItem key={i.reminderId + i.occurrenceAt} i={i} now={now} />
              ))}
            </Section>
          ) : (
            !a.overdue.length && <Empty icon={<Bell className="h-6 w-6" />} title="Nothing today" text="Enjoy the free time, or tap + to plan something." />
          )}
        </>
      ) : (
        <DayGroups list={tab === "upcoming" ? a.upcoming : a.important} now={now} />
      )}
    </div>
  );
}

function DayGroups({ list, now }: { list: AgendaItem[]; now: Date }) {
  if (!list.length) return <Empty icon={<CalendarDays className="h-6 w-6" />} title="Nothing coming up" text="Upcoming reminders for the next few months show here." />;
  const groups = new Map<string, AgendaItem[]>();
  for (const i of list) {
    const label = fmt.dayLong.format(new Date(i.occurrenceAt));
    groups.set(label, [...(groups.get(label) || []), i]);
  }
  return (
    <>
      {[...groups.entries()].map(([label, g]) => (
        <Section key={label} title={label}>
          {g.map((i) => (
            <ReminderItem key={i.reminderId + i.occurrenceAt} i={i} now={now} />
          ))}
        </Section>
      ))}
    </>
  );
}

function AllReminders({ rows }: { rows: ReminderRow[] }) {
  const a = useReminderActions();
  if (!rows.length) return <Empty icon={<ListTodo className="h-6 w-6" />} title="No reminders yet" text="Tap + to add your first one." />;
  const active = rows.filter((r) => r.status === "active");
  const done = rows.filter((r) => r.status === "done");
  const render = (r: ReminderRow) => {
    const d = new Date(r.dueAt);
    return (
      <button
        key={r.id}
        onClick={() => a.edit(r.id)}
        className={clsx("card flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-raised", r.status === "done" && "opacity-55")}
      >
        <span className={clsx("h-2 w-2 shrink-0 rounded-full", r.priority === "high" ? "bg-rose-500" : r.priority === "low" ? "bg-zinc-400" : "bg-indigo-400")} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{r.title}</span>
          <span className="flex items-center gap-1 text-xs text-muted">
            {r.recurring ? (
              <>
                <Repeat className="h-3 w-3" /> {r.recurring}
              </>
            ) : (
              `${fmt.dayShort.format(d)}${r.allDay ? "" : `, ${fmt.time.format(d)}`}`
            )}
          </span>
        </span>
        {r.amountPaise && <span className="shrink-0 text-sm font-medium text-muted">{formatINR(r.amountPaise)}</span>}
      </button>
    );
  };
  return (
    <>
      <Section title={`Active · ${active.length}`}>{active.map(render)}</Section>
      {done.length > 0 && <Section title={`Completed · ${done.length}`}>{done.map(render)}</Section>}
    </>
  );
}
