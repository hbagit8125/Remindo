"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import {
  AlarmClock,
  AlertTriangle,
  BellRing,
  CalendarDays,
  Check,
  Clock,
  ListTodo,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  Repeat,
  Star,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { CommandBar } from "./CommandBar";
import { ReminderEditor } from "./ReminderEditor";
import type { AgendaItem, ReminderInput, ReminderRow } from "./types";

type Tab = "today" | "upcoming" | "important" | "all";

function useFormatters(tz: string) {
  return useMemo(() => {
    const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: tz, ...o });
    const dayKey = f({ year: "numeric", month: "2-digit", day: "2-digit" });
    return {
      time: f({ hour: "numeric", minute: "2-digit", hour12: true }),
      dayLabel: f({ weekday: "long", day: "numeric", month: "short" }),
      short: f({ weekday: "short", day: "numeric", month: "short" }),
      dayKey: (d: Date) => dayKey.format(d),
    };
  }, [tz]);
}

function blankInput(): ReminderInput {
  const d = new Date(Date.now() + 3600000);
  return {
    title: "",
    date: d.toLocaleDateString("en-CA"),
    time: `${String(d.getHours()).padStart(2, "0")}:00`,
    recurrence: "none",
    interval: 1,
    priority: "normal",
  };
}

export function Dashboard() {
  const [tz, setTz] = useState("Asia/Kolkata");
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [rows, setRows] = useState<ReminderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("today");
  const [editing, setEditing] = useState<{ id: string | null; value: ReminderInput } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const fmt = useFormatters(tz);

  const load = useCallback(async () => {
    const [a, r] = await Promise.all([fetch("/api/agenda?days=120"), fetch("/api/reminders")]);
    if (a.status === 401) return (window.location.href = "/login");
    const aj = await a.json();
    const rj = await r.json();
    setTz(aj.tz);
    setItems(aj.items || []);
    setRows(rj.reminders || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(() => setNow(new Date()), 60000);
    const r = setInterval(load, 5 * 60000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, [load]);

  const todayKey = fmt.dayKey(now);
  const { overdue, today, upcoming, important } = useMemo(() => {
    const overdue: AgendaItem[] = [];
    const today: AgendaItem[] = [];
    const upcoming: AgendaItem[] = [];
    for (const i of items) {
      const d = new Date(i.occurrenceAt);
      const k = fmt.dayKey(d);
      if (k === todayKey) today.push(i);
      else if (d < now && !i.done) overdue.push(i);
      else if (d > now) upcoming.push(i);
    }
    const important = upcoming.filter((i) => i.priority === "high" && !i.done);
    return { overdue, today, upcoming, important };
  }, [items, now, todayKey, fmt]);

  async function act(i: AgendaItem, action: "done" | "undo" | "snooze", minutes?: number) {
    setItems((prev) =>
      prev.map((x) =>
        x.reminderId === i.reminderId && x.occurrenceAt === i.occurrenceAt
          ? { ...x, done: action === "done" ? true : action === "undo" ? false : x.done }
          : x,
      ),
    );
    await fetch("/api/occurrence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reminderId: i.reminderId, occurrenceAt: i.occurrenceAt, action, minutes }),
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this reminder and all its future alerts?")) return;
    setRows((p) => p.filter((r) => r.id !== id));
    setItems((p) => p.filter((r) => r.reminderId !== id));
    await fetch(`/api/reminders/${id}`, { method: "DELETE" });
    load();
  }

  function startEdit(id: string) {
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    const fallback: ReminderInput = {
      title: r.title,
      notes: r.notes,
      date: new Date(r.dueAt).toLocaleDateString("en-CA", { timeZone: tz }),
      time: r.allDay ? null : new Date(r.dueAt).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }),
      recurrence: "none",
      interval: 1,
      priority: r.priority,
      category: r.category,
      leadTimes: r.leadTimes,
    };
    setEditing({ id, value: { ...fallback, ...(r.input || {}) } });
  }

  async function saveEdit() {
    if (!editing) return;
    const res = editing.id
      ? await fetch(`/api/reminders/${editing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(editing.value),
        })
      : await fetch("/api/reminders", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items: [editing.value] }),
        });
    if (!res.ok) return alert((await res.json()).error || "Couldn't save");
    setEditing(null);
    load();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const pendingToday = today.filter((i) => !i.done).length;

  const tabs: { id: Tab; label: string; icon: typeof Clock; count?: number }[] = [
    { id: "today", label: "Today", icon: Clock, count: pendingToday + overdue.length },
    { id: "upcoming", label: "Upcoming", icon: CalendarDays },
    { id: "important", label: "Important", icon: Star, count: important.length },
    { id: "all", label: "All", icon: ListTodo, count: rows.filter((r) => r.status === "active").length },
  ];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:pt-10">
      <header className="mb-6 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-pink-500 shadow-lg shadow-indigo-500/30">
            <AlarmClock className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white sm:text-2xl">{greeting}</h1>
            <p className="text-sm text-zinc-400">
              {fmt.dayLabel.format(now)} · {pendingToday ? `${pendingToday} left today` : "all clear today"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setEditing({ id: null, value: blankInput() })}
            className="flex items-center gap-1 rounded-xl border border-white/10 px-3 py-2 text-sm text-zinc-300 hover:bg-white/5"
          >
            <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Manual</span>
          </button>
          <button onClick={logout} title="Lock" className="rounded-xl border border-white/10 p-2 text-zinc-400 hover:bg-white/5">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <CommandBar onCreated={load} />

      {overdue.length > 0 && (
        <button
          onClick={() => setTab("today")}
          className="mt-4 flex w-full items-center gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-left text-sm text-rose-200"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {overdue.length} overdue reminder{overdue.length > 1 ? "s" : ""}. Mark them done or snooze them.
        </button>
      )}

      <nav className="mt-6 flex gap-1 overflow-x-auto rounded-2xl bg-white/[0.03] p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition",
              tab === t.id ? "bg-white/10 text-white shadow" : "text-zinc-400 hover:text-zinc-200",
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
            {!!t.count && (
              <span className="rounded-full bg-white/10 px-1.5 text-[11px] leading-5 text-zinc-300">{t.count}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="mt-4">
        {loading ? (
          <div className="grid place-items-center py-20 text-zinc-500">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : tab === "all" ? (
          <AllList rows={rows} fmt={fmt} onEdit={startEdit} onDelete={remove} />
        ) : (
          <>
            {tab === "today" && overdue.length > 0 && (
              <Group title="Overdue" tone="danger">
                {overdue.map((i) => (
                  <Row key={i.reminderId + i.occurrenceAt} i={i} fmt={fmt} showDay act={act} onEdit={startEdit} />
                ))}
              </Group>
            )}
            {tab === "today" &&
              (today.length ? (
                <Group title="Today">
                  {today.map((i) => (
                    <Row key={i.reminderId + i.occurrenceAt} i={i} fmt={fmt} act={act} onEdit={startEdit} past={new Date(i.occurrenceAt) < now} />
                  ))}
                </Group>
              ) : (
                !overdue.length && <Empty text="Nothing today. Add something above, or enjoy the free time." />
              ))}
            {(tab === "upcoming" || tab === "important") && (
              <DayGroups list={tab === "upcoming" ? upcoming : important} fmt={fmt} act={act} onEdit={startEdit} />
            )}
          </>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setEditing(null)}>
          <div className="glass max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-zinc-900/90 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">{editing.id ? "Edit reminder" : "New reminder"}</h2>
              <button onClick={() => setEditing(null)} className="text-zinc-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <ReminderEditor value={editing.value} onChange={(value) => setEditing({ ...editing, value })} />
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-xl px-4 py-2 text-sm text-zinc-400 hover:bg-white/5">
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={!editing.value.title.trim()}
                className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

type Fmt = ReturnType<typeof useFormatters>;
type Act = (i: AgendaItem, action: "done" | "undo" | "snooze", minutes?: number) => void;

function Group({ title, tone, children }: { title: string; tone?: "danger"; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className={clsx("mb-2 px-1 text-xs font-semibold uppercase tracking-wider", tone === "danger" ? "text-rose-400" : "text-zinc-500")}>
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="glass grid place-items-center rounded-3xl px-6 py-16 text-center">
      <BellRing className="mb-3 h-8 w-8 text-zinc-600" />
      <p className="text-sm text-zinc-500">{text}</p>
    </div>
  );
}

function DayGroups({ list, fmt, act, onEdit }: { list: AgendaItem[]; fmt: Fmt; act: Act; onEdit: (id: string) => void }) {
  if (!list.length) return <Empty text="Nothing coming up." />;
  const groups = new Map<string, AgendaItem[]>();
  for (const i of list) {
    const label = fmt.dayLabel.format(new Date(i.occurrenceAt));
    groups.set(label, [...(groups.get(label) || []), i]);
  }
  return (
    <>
      {[...groups.entries()].map(([label, g]) => (
        <Group key={label} title={label}>
          {g.map((i) => (
            <Row key={i.reminderId + i.occurrenceAt} i={i} fmt={fmt} act={act} onEdit={onEdit} />
          ))}
        </Group>
      ))}
    </>
  );
}

const DOT: Record<string, string> = { high: "bg-rose-500", normal: "bg-indigo-400", low: "bg-zinc-500" };

function minutesUntilTomorrow9() {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  t.setHours(9, 0, 0, 0);
  return Math.round((t.getTime() - Date.now()) / 60000);
}

function Row({
  i,
  fmt,
  act,
  onEdit,
  showDay,
  past,
}: {
  i: AgendaItem;
  fmt: Fmt;
  act: Act;
  onEdit: (id: string) => void;
  showDay?: boolean;
  past?: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const d = new Date(i.occurrenceAt);
  const when = i.allDay ? (showDay ? fmt.short.format(d) : "All day") : showDay ? `${fmt.short.format(d)}, ${fmt.time.format(d)}` : fmt.time.format(d);

  return (
    <div
      className={clsx(
        "glass group relative flex items-center gap-3 rounded-2xl px-4 py-3 transition hover:bg-white/[0.06]",
        i.done && "opacity-50",
        i.priority === "high" && !i.done && "border-rose-500/20",
      )}
    >
      <button
        onClick={() => act(i, i.done ? "undo" : "done")}
        title={i.done ? "Undo" : "Mark done"}
        className={clsx(
          "grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition",
          i.done ? "border-emerald-400 bg-emerald-400 text-zinc-900" : "border-zinc-600 hover:border-emerald-400",
        )}
      >
        {i.done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={clsx("h-2 w-2 shrink-0 rounded-full", DOT[i.priority])} />
          <p className={clsx("truncate font-medium text-zinc-100", i.done && "line-through")}>{i.title}</p>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span className={clsx(past && !i.done && "text-amber-400")}>{when}</span>
          {i.recurring && (
            <span className="flex items-center gap-1">
              <Repeat className="h-3 w-3" /> {i.recurring}
            </span>
          )}
          {i.category && <span className="rounded bg-white/5 px-1.5 py-0.5">{i.category}</span>}
          {i.snoozedUntil && <span className="text-indigo-300">snoozed → {fmt.time.format(new Date(i.snoozedUntil))}</span>}
        </div>
        {i.notes && <p className="mt-1 truncate text-xs text-zinc-500">{i.notes}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
        {!i.done && (
          <div className="relative">
            <button onClick={() => setMenu(!menu)} title="Snooze" className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white">
              <Clock className="h-4 w-4" />
            </button>
            {menu && (
              <div className="absolute right-0 top-10 z-10 w-36 overflow-hidden rounded-xl border border-white/10 bg-zinc-900 py-1 shadow-xl">
                {[
                  ["15 min", 15],
                  ["1 hour", 60],
                  ["3 hours", 180],
                  ["Tomorrow 9am", minutesUntilTomorrow9()],
                ].map(([l, m]) => (
                  <button
                    key={l}
                    onClick={() => {
                      setMenu(false);
                      act(i, "snooze", m as number);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-white/5"
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {i.done ? (
          <button onClick={() => act(i, "undo")} title="Undo" className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white">
            <Undo2 className="h-4 w-4" />
          </button>
        ) : (
          <button onClick={() => onEdit(i.reminderId)} title="Edit" className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white">
            <Pencil className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function AllList({
  rows,
  fmt,
  onEdit,
  onDelete,
}: {
  rows: ReminderRow[];
  fmt: Fmt;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (!rows.length) return <Empty text="No reminders yet." />;
  const active = rows.filter((r) => r.status === "active");
  const done = rows.filter((r) => r.status === "done");
  const render = (r: ReminderRow) => {
    const d = new Date(r.dueAt);
    return (
      <div key={r.id} className={clsx("glass group flex items-center gap-3 rounded-2xl px-4 py-3", r.status === "done" && "opacity-50")}>
        <span className={clsx("h-2 w-2 shrink-0 rounded-full", DOT[r.priority])} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-zinc-100">{r.title}</p>
          <p className="text-xs text-zinc-500">
            {r.recurring ? `${r.recurring} · from ${fmt.short.format(d)}` : `${fmt.short.format(d)}${r.allDay ? "" : `, ${fmt.time.format(d)}`}`}
          </p>
        </div>
        <button onClick={() => onEdit(r.id)} className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white" title="Edit">
          <Pencil className="h-4 w-4" />
        </button>
        <button onClick={() => onDelete(r.id)} className="rounded-lg p-2 text-zinc-400 hover:bg-rose-500/20 hover:text-rose-300" title="Delete">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    );
  };
  return (
    <>
      <Group title={`Active · ${active.length}`}>{active.map(render)}</Group>
      {done.length > 0 && <Group title={`Done · ${done.length}`}>{done.map(render)}</Group>}
    </>
  );
}
