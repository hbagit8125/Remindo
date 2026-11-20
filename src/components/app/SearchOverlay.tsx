"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckSquare, Loader2, Search, X } from "lucide-react";
import { api, fmt, relativeDay } from "./client";
import { useSheet } from "./AddSheet";
import { useReminderActions } from "./rows";
import { categoryMeta, type ReminderRow, type Task, type Transaction } from "../types";
import { formatINR } from "@/lib/money";

type Other = { id: string; emoji: string; title: string; sub: string; href: string };
type Results = { reminders: ReminderRow[]; tasks: Task[]; transactions: Transaction[]; other?: Other[] };

/** Search everything: reminders, tasks and money entries. */
export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const { open } = useSheet();
  const reminders = useReminderActions();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  useEffect(() => {
    if (q.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear results for short queries
      setRes(null);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        setRes(await api<Results>(`/api/search?q=${encodeURIComponent(q.trim())}`));
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const total = res ? res.reminders.length + res.tasks.length + res.transactions.length + (res.other?.length || 0) : 0;
  const row = "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-raised";

  return (
    <div className="animate-fade fixed inset-0 z-[65] bg-black/50 backdrop-blur-sm md:p-10" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-pop mx-auto flex h-full max-w-xl flex-col overflow-hidden border-line bg-[var(--bg)] md:h-auto md:max-h-[80vh] md:rounded-3xl md:border"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Search className="h-5 w-5 shrink-0 text-subtle" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search everything…"
            className="min-w-0 flex-1 bg-transparent py-2 text-[16px] outline-none placeholder:text-subtle"
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-subtle" />}
          <button onClick={onClose} aria-label="Close search" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-raised">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {!res ? (
            <p className="px-3 py-8 text-center text-sm text-muted">Type at least 2 letters. Try a name, a shop, a category, or an amount like 450.</p>
          ) : !total ? (
            <p className="px-3 py-8 text-center text-sm text-muted">Nothing found for “{q}”.</p>
          ) : (
            <>
              {res.reminders.length > 0 && <Heading>Reminders</Heading>}
              {res.reminders.map((r) => (
                <button
                  key={r.id}
                  className={row}
                  onClick={() => {
                    onClose();
                    reminders.edit(r.id);
                  }}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-500/15 text-indigo-500">
                    <Bell className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {r.recurring || `${fmt.dayShort.format(new Date(r.dueAt))}${r.allDay ? "" : `, ${fmt.time.format(new Date(r.dueAt))}`}`}
                      {r.status === "done" ? " · done" : ""}
                    </span>
                  </span>
                  {r.amountPaise ? <span className="text-sm text-muted">{formatINR(r.amountPaise)}</span> : null}
                </button>
              ))}

              {res.tasks.length > 0 && <Heading>Tasks</Heading>}
              {res.tasks.map((t) => (
                <button
                  key={t.id}
                  className={row}
                  onClick={() => {
                    onClose();
                    open({ mode: "task", id: t.id, value: { title: t.title, notes: t.notes, dueDate: t.dueDate, priority: t.priority, focus: Boolean(t.focusDate) } });
                  }}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-500">
                    <CheckSquare className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t.title}</span>
                    <span className="block text-xs text-muted">
                      {t.done ? "Done" : "Open"}
                      {t.dueDate ? ` · due ${relativeDay(t.dueDate)}` : ""}
                    </span>
                  </span>
                </button>
              ))}

              {res.transactions.length > 0 && <Heading>Money</Heading>}
              {res.transactions.map((t) => {
                const m = categoryMeta(t.category);
                return (
                  <button
                    key={t.id}
                    className={row}
                    onClick={() => {
                      onClose();
                      open({
                        mode: "expense",
                        id: t.id,
                        value: { type: t.type, amount: t.amountPaise / 100, category: t.category, note: t.note, merchant: t.merchant, method: t.method, date: t.date },
                      });
                    }}
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: `${m.color}22` }}>
                      {m.emoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{t.note || t.category}</span>
                      <span className="block truncate text-xs text-muted">
                        {relativeDay(t.date)} · {[t.category, t.merchant].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className={t.type === "income" ? "font-semibold text-emerald-500" : "font-semibold"}>
                      {t.type === "income" ? "+" : "−"}
                      {formatINR(t.amountPaise)}
                    </span>
                  </button>
                );
              })}

              {(res.other || []).length > 0 && <Heading>Lists, people & more</Heading>}
              {(res.other || []).map((o) => (
                <button
                  key={o.id}
                  className={row}
                  onClick={() => {
                    onClose();
                    router.push(o.href);
                  }}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-raised text-base">{o.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{o.title}</span>
                    <span className="block truncate text-xs text-muted">{o.sub}</span>
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-subtle">{children}</p>;
}
