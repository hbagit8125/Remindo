"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { Bell, Check, ChevronDown, Loader2, Mic, MicOff, Sparkles, Trash2, Wallet, X } from "lucide-react";
import { api, dayKey, hideId, refreshAll, relativeDay, unhideId, useData } from "./client";
import { useToast } from "./toast";
import { ReminderEditor } from "./ReminderEditor";
import { ExpenseEditor } from "./ExpenseEditor";
import { categoryMeta, type ReminderInput, type TransactionInput } from "../types";
import { formatINR } from "@/lib/money";

type SheetState =
  | { mode: "ask" }
  | { mode: "reminder"; id?: string; value?: ReminderInput }
  | { mode: "expense"; id?: string; value?: TransactionInput };

const SheetCtx = createContext<{ open: (s: SheetState) => void } | null>(null);

export function useSheet() {
  const c = useContext(SheetCtx);
  if (!c) throw new Error("useSheet outside SheetProvider");
  return c;
}

export function blankReminder(): ReminderInput {
  const d = new Date(Date.now() + 3600000);
  return {
    title: "",
    date: dayKey(d),
    time: `${String(d.getHours()).padStart(2, "0")}:00`,
    recurrence: "none",
    interval: 1,
    priority: "normal",
  };
}

export function blankExpense(): TransactionInput {
  return { type: "expense", amount: 0, category: "Food", method: "upi", date: dayKey(new Date()) };
}

export function SheetProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SheetState | null>(null);
  const open = useCallback((s: SheetState) => setState(s), []);
  const close = useCallback(() => setState(null), []);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [state, close]);

  return (
    <SheetCtx.Provider value={{ open }}>
      {children}
      {state && (
        <div className="animate-fade fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm md:items-center md:p-6" onClick={close}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="animate-sheet pb-safe max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-line bg-[var(--bg)] md:max-w-xl md:rounded-3xl"
          >
            <div className="sticky top-0 z-10 bg-[var(--bg)]/95 px-5 pt-3 backdrop-blur">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--line)] md:hidden" />
              <SheetHeader state={state} setState={setState} close={close} />
            </div>
            <div className="px-5 pb-6 pt-2">
              {state.mode === "ask" && <AskPanel close={close} />}
              {state.mode === "reminder" && <ReminderPanel key={state.id || "new"} id={state.id} initial={state.value} close={close} />}
              {state.mode === "expense" && <ExpensePanel key={state.id || "new"} id={state.id} initial={state.value} close={close} />}
            </div>
          </div>
        </div>
      )}
    </SheetCtx.Provider>
  );
}

function SheetHeader({ state, setState, close }: { state: SheetState; setState: (s: SheetState) => void; close: () => void }) {
  const editing = state.mode !== "ask" && "id" in state && state.id;
  const tabs = [
    { mode: "ask" as const, label: "Ask", icon: Sparkles },
    { mode: "reminder" as const, label: "Reminder", icon: Bell },
    { mode: "expense" as const, label: "Money", icon: Wallet },
  ];
  return (
    <div className="flex items-center gap-2 pb-3">
      {editing ? (
        <h2 className="flex-1 text-lg font-semibold">{state.mode === "reminder" ? "Edit reminder" : "Edit entry"}</h2>
      ) : (
        <div className="flex flex-1 gap-1 rounded-xl bg-raised p-1">
          {tabs.map((t) => (
            <button
              key={t.mode}
              onClick={() => setState({ mode: t.mode })}
              className={clsx(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition",
                state.mode === t.mode ? "bg-surface text-fg shadow-sm ring-1 ring-line" : "text-muted hover:text-fg",
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>
      )}
      <button onClick={close} className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-raised hover:text-fg" aria-label="Close">
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

// ------------------------------------------------------------- Ask (AI / voice)

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

const EXAMPLES = [
  "Spent 450 on lunch at Zomato",
  "Petrol 1200 yesterday, card",
  "Call mom tomorrow at 7pm",
  "Paid rent 15000, remind me on the 5th next month",
  "Netflix 649 every month on the 12th",
  "Salary credited 85000",
];

type Draft = { kind: "reminder"; value: ReminderInput } | { kind: "expense"; value: TransactionInput };

function useSpeech(onFinal: (text: string) => void, onText: (text: string) => void) {
  const recRef = useRef<SpeechRec | null>(null);
  const textRef = useRef("");
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-IN";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      textRef.current = t;
      onText(t);
    };
    rec.onend = () => {
      setListening(false);
      if (textRef.current.trim()) onFinal(textRef.current);
    };
    rec.onerror = (e) => {
      setListening(false);
      if (e.error === "not-allowed") setError("Microphone permission was denied.");
    };
    recRef.current = rec;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- feature detection on mount
    setSupported(true);
    return () => rec.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    const rec = recRef.current;
    if (!rec) return;
    if (listening) return rec.stop();
    textRef.current = "";
    setError("");
    setListening(true);
    rec.start();
  };
  return { listening, supported, error, toggle };
}

function AskPanel({ close }: { close: () => void }) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [note, setNote] = useState("");

  const parse = useCallback(async (input: string) => {
    if (!input.trim()) return;
    setLoading(true);
    setNote("");
    try {
      const r = await api<{ reminders: ReminderInput[]; transactions: TransactionInput[]; warning?: string }>("/api/parse", {
        method: "POST",
        json: { text: input },
      });
      setDrafts([
        ...r.transactions.map((value) => ({ kind: "expense" as const, value })),
        ...r.reminders.map((value) => ({ kind: "reminder" as const, value })),
      ]);
      setExpanded(null);
      if (r.warning) setNote(r.warning);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const speech = useSpeech(parse, setText);

  async function saveAll() {
    setSaving(true);
    const reminders = drafts.filter((d) => d.kind === "reminder").map((d) => d.value);
    const transactions = drafts.filter((d) => d.kind === "expense").map((d) => d.value);
    try {
      if (transactions.some((t) => !(t as TransactionInput).amount)) throw new Error("Add an amount to each money entry");
      if (reminders.length) await api("/api/reminders", { method: "POST", json: { items: reminders } });
      if (transactions.length) await api("/api/transactions", { method: "POST", json: { items: transactions } });
      const parts = [
        reminders.length && `${reminders.length} reminder${reminders.length > 1 ? "s" : ""}`,
        transactions.length && `${transactions.length} entr${transactions.length > 1 ? "ies" : "y"}`,
      ].filter(Boolean);
      toast({ message: `Added ${parts.join(" and ")}` });
      refreshAll();
      close();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-end gap-2">
        <textarea
          rows={2}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              parse(text);
            }
          }}
          placeholder={speech.listening ? "Listening…" : "Spent 300 on groceries · Call mom at 7pm · …"}
          className="min-h-[56px] flex-1 resize-none rounded-2xl border border-line bg-raised px-4 py-3 text-[15px] text-fg outline-none placeholder:text-subtle focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20"
        />
        {speech.supported && (
          <button
            onClick={speech.toggle}
            aria-label="Speak"
            className={clsx(
              "grid h-14 w-14 shrink-0 place-items-center rounded-2xl border transition",
              speech.listening ? "listening border-rose-400 bg-rose-500 text-white" : "border-line bg-raised text-fg hover:bg-surface",
            )}
          >
            {speech.listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
        )}
      </div>

      {!drafts.length && (
        <>
          <button
            onClick={() => parse(text)}
            disabled={loading || !text.trim()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-500 py-3.5 font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:brightness-110 disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? "Understanding…" : "Continue"}
          </button>
          <p className="mb-2 mt-5 text-xs font-medium uppercase tracking-wider text-subtle">Try</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setText(ex)}
                className="rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:border-indigo-400/50 hover:text-fg"
              >
                {ex}
              </button>
            ))}
          </div>
        </>
      )}

      {(note || speech.error) && <p className="mt-3 text-sm text-amber-600 dark:text-amber-300">{note || speech.error}</p>}

      {drafts.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-muted">Here&apos;s what I understood. Tap to adjust.</p>
          {drafts.map((d, i) => (
            <div key={i} className="card overflow-hidden rounded-2xl">
              <div className="flex items-center gap-3 p-3">
                <button onClick={() => setExpanded(expanded === i ? null : i)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <DraftSummary d={d} />
                  <ChevronDown className={clsx("ml-auto h-4 w-4 shrink-0 text-subtle transition", expanded === i && "rotate-180")} />
                </button>
                <button onClick={() => setDrafts(drafts.filter((_, j) => j !== i))} className="rounded-lg p-2 text-subtle hover:text-rose-500" aria-label="Remove">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {expanded === i && (
                <div className="border-t border-line p-4">
                  {d.kind === "reminder" ? (
                    <ReminderEditor value={d.value} onChange={(v) => setDrafts(drafts.map((x, j) => (j === i ? { kind: "reminder", value: v } : x)))} />
                  ) : (
                    <ExpenseEditor value={d.value} onChange={(v) => setDrafts(drafts.map((x, j) => (j === i ? { kind: "expense", value: v } : x)))} />
                  )}
                </div>
              )}
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <button onClick={() => setDrafts([])} className="flex-1 rounded-2xl border border-line py-3 text-sm font-medium text-muted hover:bg-raised">
              Start over
            </button>
            <button
              onClick={saveAll}
              disabled={saving}
              className="flex flex-[2] items-center justify-center gap-2 rounded-2xl bg-fg py-3 text-sm font-semibold text-[var(--bg)] hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save {drafts.length > 1 ? `all ${drafts.length}` : ""}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DraftSummary({ d }: { d: Draft }) {
  if (d.kind === "expense") {
    const m = categoryMeta(d.value.category);
    const income = d.value.type === "income";
    return (
      <>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg" style={{ background: `${m.color}22` }}>
          {m.emoji}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{d.value.note || d.value.category}</span>
          <span className="block text-xs text-muted">
            {income ? "Income" : "Expense"} · {relativeDay(d.value.date)}{d.value.method ? ` · ${d.value.method.toUpperCase()}` : ""}
          </span>
        </span>
        <span className={clsx("ml-auto shrink-0 font-semibold", income ? "text-emerald-500" : "text-fg")}>
          {income ? "+" : ""}
          {formatINR(Math.round((d.value.amount || 0) * 100))}
        </span>
      </>
    );
  }
  const v = d.value;
  return (
    <>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500/15 text-indigo-500">
        <Bell className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{v.title}</span>
        <span className="block text-xs text-muted">
          Reminder · {relativeDay(v.date)}
          {v.time ? `, ${v.time}` : ""}
          {v.recurrence !== "none" ? ` · ${v.recurrence}` : ""}
          {v.amount ? ` · ${formatINR(Math.round(v.amount * 100))}` : ""}
        </span>
      </span>
    </>
  );
}

// ------------------------------------------------------------- manual forms

function PanelActions({
  saving,
  disabled,
  onSave,
  onDelete,
}: {
  saving: boolean;
  disabled?: boolean;
  onSave: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="mt-6 flex gap-2">
      {onDelete && (
        <button onClick={onDelete} className="grid h-12 w-12 place-items-center rounded-2xl border border-line text-rose-500 hover:bg-rose-500/10" aria-label="Delete">
          <Trash2 className="h-5 w-5" />
        </button>
      )}
      <button
        onClick={onSave}
        disabled={saving || disabled}
        className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-fg text-sm font-semibold text-[var(--bg)] hover:opacity-90 disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Save
      </button>
    </div>
  );
}

function ReminderPanel({ id, initial, close }: { id?: string; initial?: ReminderInput; close: () => void }) {
  const { toast, undoable } = useToast();
  const [value, setValue] = useState<ReminderInput>(initial || blankReminder());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setSaving(true);
    try {
      if (id) await api(`/api/reminders/${id}`, { method: "PATCH", json: value });
      else await api("/api/reminders", { method: "POST", json: { items: [value] } });
      toast({ message: id ? "Reminder updated" : "Reminder added" });
      refreshAll();
      close();
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  function remove() {
    if (!id) return;
    close();
    hideId(id);
    undoable(
      "Reminder deleted",
      () => api(`/api/reminders/${id}`, { method: "DELETE" }).then(refreshAll),
      () => unhideId(id),
    );
  }

  return (
    <>
      <ReminderEditor value={value} onChange={setValue} />
      {err && <p className="mt-3 text-sm text-rose-500">{err}</p>}
      <PanelActions saving={saving} disabled={!value.title.trim()} onSave={save} onDelete={id ? remove : undefined} />
    </>
  );
}

function ExpensePanel({ id, initial, close }: { id?: string; initial?: TransactionInput; close: () => void }) {
  const { toast, undoable } = useToast();
  const [value, setValue] = useState<TransactionInput>(initial || blankExpense());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const { data } = useData<{ usedCategories: { category: string; type: string }[] }>("/api/transactions");
  const extra = (data?.usedCategories || []).filter((c) => c.type === value.type).map((c) => c.category);

  async function save() {
    setSaving(true);
    try {
      if (id) await api(`/api/transactions/${id}`, { method: "PATCH", json: value });
      else await api("/api/transactions", { method: "POST", json: { items: [value] } });
      toast({ message: id ? "Entry updated" : `${value.type === "income" ? "Income" : "Expense"} added · ${formatINR(Math.round(value.amount * 100))}` });
      refreshAll();
      close();
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  function remove() {
    if (!id) return;
    close();
    hideId(id);
    undoable(
      "Entry deleted",
      () => api(`/api/transactions/${id}`, { method: "DELETE" }).then(refreshAll),
      () => unhideId(id),
    );
  }

  return (
    <>
      <ExpenseEditor value={value} onChange={setValue} extraCategories={extra} autoFocus={!id} />
      {err && <p className="mt-3 text-sm text-rose-500">{err}</p>}
      <PanelActions saving={saving} disabled={!value.amount || value.amount <= 0} onSave={save} onDelete={id ? remove : undefined} />
    </>
  );
}
