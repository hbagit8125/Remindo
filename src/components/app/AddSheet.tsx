"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { Bell, Camera, Check, CheckSquare, ChevronDown, Handshake, ListChecks, Loader2, MapPin, Mic, MicOff, Repeat, Sparkles, Star, Trash2, Wallet, X } from "lucide-react";
import { api, dayKey, hideId, refreshAll, relativeDay, unhideId, useData } from "./client";
import { useToast } from "./toast";
import { ReminderEditor } from "./ReminderEditor";
import { ExpenseEditor } from "./ExpenseEditor";
import { TaskEditor } from "./TaskEditor";
import { categoryMeta, type DueInput, type Favourite, type FavouriteSuggestion, type ReminderInput, type TaskInput, type TransactionInput } from "../types";
import { field, label } from "./ReminderEditor";
import { formatINR } from "@/lib/money";

type SheetState =
  | { mode: "ask"; text?: string }
  | { mode: "reminder"; id?: string; value?: ReminderInput }
  | { mode: "expense"; id?: string; value?: TransactionInput }
  | { mode: "task"; id?: string; value?: TaskInput };

export type SheetMode = SheetState["mode"];

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

export function blankTask(): TaskInput {
  return { title: "", focus: true, priority: "normal", dueDate: null };
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
            className="animate-sheet pb-safe max-h-[92vh] max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-3xl border border-line bg-[var(--bg)] md:max-w-xl md:rounded-3xl"
          >
            <div className="sticky top-0 z-10 bg-[var(--bg)]/95 px-5 pt-3 backdrop-blur">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--line)] md:hidden" />
              <SheetHeader state={state} setState={setState} close={close} />
            </div>
            <div className="px-5 pb-6 pt-2">
              {state.mode === "ask" && <AskPanel close={close} initialText={state.text} />}
              {state.mode === "reminder" && <ReminderPanel key={state.id || "new"} id={state.id} initial={state.value} close={close} />}
              {state.mode === "expense" && <ExpensePanel key={state.id || "new"} id={state.id} initial={state.value} close={close} />}
              {state.mode === "task" && <TaskPanel key={state.id || "new"} id={state.id} initial={state.value} close={close} />}
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
    { mode: "task" as const, label: "Task", icon: CheckSquare },
    { mode: "expense" as const, label: "Money", icon: Wallet },
  ];
  return (
    <div className="flex items-center gap-2 pb-3">
      {editing ? (
        <h2 className="flex-1 text-lg font-semibold">{state.mode === "reminder" ? "Edit reminder" : state.mode === "task" ? "Edit task" : "Edit entry"}</h2>
      ) : (
        <div className="flex flex-1 gap-1 rounded-xl bg-raised p-1">
          {tabs.map((t) => (
            <button
              key={t.mode}
              onClick={() => setState({ mode: t.mode })}
              className={clsx(
                "flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-[13px] font-medium transition sm:gap-1.5 sm:text-sm",
                state.mode === t.mode ? "bg-surface text-fg shadow-sm ring-1 ring-line" : "text-muted hover:text-fg",
              )}
            >
              <t.icon className="h-4 w-4 shrink-0" />
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

type Candidate = { kind: "reminder" | "task"; id: string; title: string; occurrenceAt?: string; description: string };
type Proposal = {
  command: { action: string; target: string; date?: string | null; time?: string | null; minutes?: number | null };
  candidates: Candidate[];
};

const EXAMPLES = [
  "How much did I spend on food this month?",
  "What's due this week?",
  "Spent 450 on lunch at Zomato",
  "Petrol 1200 yesterday, card",
  "Call mom tomorrow at 7pm",
  "Buy milk and eggs",
  "Paid rent 15000, remind me on the 5th next month",
  "Netflix 649 every month on the 12th",
  "Salary credited 85000",
];

type ListDraft = { list: string; items: string[] };
type PlaceDraft = { text: string; place: string; on: "arrive" | "leave"; repeat: boolean };
type Draft =
  | { kind: "place"; value: PlaceDraft }
  | { kind: "list"; value: ListDraft }
  | { kind: "due"; value: DueInput }
  | { kind: "reminder"; value: ReminderInput }
  | { kind: "expense"; value: TransactionInput }
  | { kind: "task"; value: TaskInput };

function useSpeech(onFinal: (text: string) => void, onText: (text: string) => void, lang = "en-IN") {
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
    rec.lang = lang;
    rec.start();
  };
  return { listening, supported, error, toggle };
}

function AskPanel({ close, initialText }: { close: () => void; initialText?: string }) {
  const { toast } = useToast();
  const [text, setText] = useState(initialText || "");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [answer, setAnswer] = useState<{ text: string; lines?: string[] } | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const [lang, setLang] = useState<"en-IN" | "ml-IN">(() => {
    try {
      return (localStorage.getItem("micLang") as "en-IN" | "ml-IN") || "en-IN";
    } catch {
      return "en-IN";
    }
  });
  const switchLang = () => {
    const next = lang === "en-IN" ? "ml-IN" : "en-IN";
    setLang(next);
    try {
      localStorage.setItem("micLang", next);
    } catch {}
  };

  const parse = useCallback(async (input: string) => {
    if (!input.trim()) return;
    setLoading(true);
    setNote("");
    try {
      const r = await api<{
        reminders: ReminderInput[];
        transactions: TransactionInput[];
        tasks: TaskInput[];
        dues?: DueInput[];
        listItems?: ListDraft[];
        placeReminders?: PlaceDraft[];
        warning?: string;
        answer?: { text: string; lines?: string[] } | null;
        proposals?: Proposal[];
      }>("/api/parse", {
        method: "POST",
        json: { text: input },
      });
      setAnswer(r.answer || null);
      setProposals(r.proposals || []);
      setDoneIds([]);
      setDrafts([
        ...r.transactions.map((value) => ({ kind: "expense" as const, value })),
        ...(r.placeReminders || []).map((value) => ({ kind: "place" as const, value })),
        ...(r.listItems || []).map((value) => ({ kind: "list" as const, value })),
        ...(r.dues || []).map((value) => ({ kind: "due" as const, value })),
        ...(r.tasks || []).map((value) => ({ kind: "task" as const, value })),
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

  const speech = useSpeech(parse, setText, lang);

  async function runProposal(p: Proposal, c: Candidate) {
    try {
      const r = await api<{ message: string }>("/api/command", {
        method: "POST",
        json: { action: p.command.action, kind: c.kind, id: c.id, occurrenceAt: c.occurrenceAt, date: p.command.date, time: p.command.time, minutes: p.command.minutes },
      });
      setDoneIds((x) => [...x, `${p.command.action}:${c.id}`]);
      toast({ message: r.message });
      refreshAll();
    } catch (e) {
      toast({ message: (e as Error).message, tone: "error" });
    }
  }

  // Opened from "Share → Remindo" (e.g. a bank SMS): understand it straight away.
  const autoRan = useRef(false);
  useEffect(() => {
    if (initialText && !autoRan.current) {
      autoRan.current = true;
      parse(initialText);
    }
  }, [initialText, parse]);

  async function saveAll() {
    setSaving(true);
    const reminders = drafts.filter((d) => d.kind === "reminder").map((d) => d.value);
    const transactions = drafts.filter((d) => d.kind === "expense").map((d) => d.value);
    const tasks = drafts.filter((d) => d.kind === "task").map((d) => d.value);
    const dues = drafts.filter((d) => d.kind === "due").map((d) => d.value);
    const listAdds = drafts.filter((d) => d.kind === "list").map((d) => d.value as ListDraft);
    const placeAdds = drafts.filter((d) => d.kind === "place").map((d) => d.value as PlaceDraft);
    try {
      if (transactions.some((t) => !(t as TransactionInput).amount)) throw new Error("Add an amount to each money entry");
      if (reminders.length) await api("/api/reminders", { method: "POST", json: { items: reminders } });
      if (transactions.length) await api("/api/transactions", { method: "POST", json: { items: transactions } });
      if (tasks.length) await api("/api/tasks", { method: "POST", json: { items: tasks } });
      if (dues.length) await api("/api/dues", { method: "POST", json: { items: dues } });
      for (const l of listAdds) await api("/api/lists/add", { method: "POST", json: l });
      if (placeAdds.length) await api("/api/place-reminders", { method: "POST", json: { items: placeAdds } });
      const parts = [
        placeAdds.length && `${placeAdds.length} place reminder${placeAdds.length > 1 ? "s" : ""}`,
        listAdds.length && `${listAdds.reduce((n, l) => n + l.items.length, 0)} list item${listAdds.reduce((n, l) => n + l.items.length, 0) > 1 ? "s" : ""}`,
        dues.length && `${dues.length} due${dues.length > 1 ? "s" : ""}`,
        reminders.length && `${reminders.length} reminder${reminders.length > 1 ? "s" : ""}`,
        tasks.length && `${tasks.length} task${tasks.length > 1 ? "s" : ""}`,
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
          enterKeyHint="enter"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // Grow with the text (up to about a third of the screen), then scroll.
            const el = e.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.35))}px`;
          }}
          onFocus={(e) => {
            // Keep the box and the Continue button in view once the keyboard is up.
            const el = e.currentTarget;
            setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
          }}
          onKeyDown={(e) => {
            // Phones: Enter makes a new line; only the button sends it.
            // Computers: Enter sends, Shift+Enter makes a new line.
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            if (window.matchMedia("(pointer: coarse)").matches) return;
            e.preventDefault();
            parse(text);
          }}
          placeholder={speech.listening ? "Listening…" : "Spent 300 on groceries · Call mom at 7pm · …"}
          className="min-h-[56px] flex-1 resize-none rounded-2xl border border-line bg-raised px-4 py-3 text-[15px] text-fg outline-none placeholder:text-subtle focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20"
        />
        {speech.supported && (
          <div className="flex flex-col items-center gap-1">
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
          <button onClick={switchLang} className="rounded-md px-1.5 text-[11px] font-semibold text-muted hover:text-fg" title="Voice language">
            {lang === "en-IN" ? "EN" : "മല"}
          </button>
          </div>
        )}
      </div>

      {answer && (
        <div className="animate-pop mt-4 rounded-2xl border border-indigo-400/30 bg-indigo-500/10 p-4">
          <p className="text-[15px] font-medium">💬 {answer.text}</p>
          {answer.lines?.length ? (
            <ul className="mt-2 space-y-1 text-sm text-muted">
              {answer.lines.map((l, i) => (
                <li key={i}>• {l}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {proposals.length > 0 && (
        <div className="mt-4 space-y-2">
          {proposals.map((p, pi) =>
            p.candidates.length ? (
              <div key={pi} className="space-y-2">
                {p.candidates.length > 1 && !p.candidates.some((o) => doneIds.includes(`${p.command.action}:${o.id}`)) && (
                  <p className="px-1 text-xs text-muted">Which one did you mean? Pick one.</p>
                )}
                {p.candidates.map((c) => {
                const done = doneIds.includes(`${p.command.action}:${c.id}`);
                // Several matches for one command: once you pick one, the others are skipped.
                if (!done && p.candidates.some((o) => doneIds.includes(`${p.command.action}:${o.id}`))) return null;
                return (
                  <div key={`${pi}-${c.id}`} className="card flex items-center gap-3 rounded-2xl p-3">
                    <span className="min-w-0 flex-1 text-sm">{c.description}</span>
                    <button
                      disabled={done}
                      onClick={() => runProposal(p, c)}
                      className={clsx(
                        "shrink-0 rounded-xl px-3 py-2 text-xs font-semibold",
                        done ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : "bg-fg text-[var(--bg)]",
                      )}
                    >
                      {done ? "Done ✓" : "Do it"}
                    </button>
                  </div>
                );
              })}
              </div>
            ) : (
              <p key={pi} className="text-sm text-muted">
                Couldn&apos;t find anything matching “{p.command.target}”.
              </p>
            ),
          )}
        </div>
      )}

      {!drafts.length && (
        <>
          <button
            onClick={() => {
              setAnswer(null);
              setProposals([]);
              parse(text);
            }}
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
                  ) : d.kind === "place" ? (
                    <PlaceDraftEditor value={d.value} onChange={(v) => setDrafts(drafts.map((x, j) => (j === i ? { kind: "place", value: v } : x)))} />
                  ) : d.kind === "list" ? (
                    <ListDraftEditor value={d.value} onChange={(v) => setDrafts(drafts.map((x, j) => (j === i ? { kind: "list", value: v } : x)))} />
                  ) : d.kind === "due" ? (
                    <DueEditor value={d.value} onChange={(v) => setDrafts(drafts.map((x, j) => (j === i ? { kind: "due", value: v } : x)))} />
                  ) : d.kind === "task" ? (
                    <TaskEditor value={d.value} onChange={(v) => setDrafts(drafts.map((x, j) => (j === i ? { kind: "task", value: v } : x)))} />
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

function PlaceDraftEditor({ value, onChange }: { value: PlaceDraft; onChange: (v: PlaceDraft) => void }) {
  return (
    <div className="grid gap-3">
      <div>
        <label className={label}>Remind me to</label>
        <input className={field} value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>When I</label>
          <select className={field} value={value.on} onChange={(e) => onChange({ ...value, on: e.target.value as PlaceDraft["on"] })}>
            <option value="arrive">reach</option>
            <option value="leave">leave</option>
          </select>
        </div>
        <div>
          <label className={label}>Place</label>
          <input className={field} value={value.place} onChange={(e) => onChange({ ...value, place: e.target.value })} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={value.repeat} onChange={(e) => onChange({ ...value, repeat: e.target.checked })} className="h-4 w-4 accent-indigo-500" />
        Every time
      </label>
      <p className="text-xs text-muted">Works while Remindo is open on your phone. Save the place in More → Places.</p>
    </div>
  );
}

function ListDraftEditor({ value, onChange }: { value: ListDraft; onChange: (v: ListDraft) => void }) {
  return (
    <div className="grid gap-3">
      <div>
        <label className={label}>List</label>
        <input className={field} value={value.list} onChange={(e) => onChange({ ...value, list: e.target.value })} />
      </div>
      <div>
        <label className={label}>Items (one per line)</label>
        <textarea
          rows={Math.max(2, value.items.length)}
          className={field}
          value={value.items.join("\n")}
          onChange={(e) => onChange({ ...value, items: e.target.value.split("\n") })}
        />
      </div>
    </div>
  );
}

function DueEditor({ value, onChange }: { value: DueInput; onChange: (v: DueInput) => void }) {
  return (
    <div className="grid gap-3">
      <div className="flex rounded-xl bg-raised p-1">
        {(
          [
            ["they_owe", "They owe me"],
            ["i_owe", "I owe them"],
          ] as const
        ).map(([d, l]) => (
          <button
            key={d}
            type="button"
            onClick={() => onChange({ ...value, direction: d })}
            className={clsx("flex-1 rounded-lg py-2 text-sm font-medium", value.direction === d ? "bg-surface shadow-sm ring-1 ring-line" : "text-muted")}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Person</label>
          <input className={field} value={value.person} onChange={(e) => onChange({ ...value, person: e.target.value })} />
        </div>
        <div>
          <label className={label}>Amount (₹)</label>
          <input type="number" inputMode="decimal" className={field} value={value.amount || ""} onChange={(e) => onChange({ ...value, amount: Number(e.target.value) || 0 })} />
        </div>
      </div>
      <div>
        <label className={label}>For (optional)</label>
        <input className={field} value={value.note || ""} onChange={(e) => onChange({ ...value, note: e.target.value || null })} />
      </div>
      <div>
        <label className={label}>Remind me on (default: in 3 days)</label>
        <input type="date" className={field} value={value.remindOn || ""} onChange={(e) => onChange({ ...value, remindOn: e.target.value || undefined })} />
      </div>
    </div>
  );
}

function DraftSummary({ d }: { d: Draft }) {
  if (d.kind === "place") {
    return (
      <>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange-500/15 text-orange-500">
          <MapPin className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{d.value.text}</span>
          <span className="block text-xs text-muted">
            {d.value.on === "arrive" ? "When you reach" : "When you leave"} {d.value.place}
            {d.value.repeat ? " · every time" : ""}
          </span>
        </span>
      </>
    );
  }
  if (d.kind === "list") {
    const items = d.value.items.filter((x) => x.trim());
    return (
      <>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-500/15 text-teal-500">
          <ListChecks className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{items.join(", ")}</span>
          <span className="block text-xs text-muted">Add to {d.value.list} list</span>
        </span>
      </>
    );
  }
  if (d.kind === "due") {
    const v = d.value;
    return (
      <>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-500">
          <Handshake className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{v.direction === "they_owe" ? `${v.person} owes you` : `You owe ${v.person}`}</span>
          <span className="block text-xs text-muted">Due{v.note ? ` · ${v.note}` : ""} · reminder in 3 days</span>
        </span>
        <span className="ml-auto shrink-0 font-semibold">{formatINR(Math.round((v.amount || 0) * 100))}</span>
      </>
    );
  }
  if (d.kind === "task") {
    const v = d.value;
    return (
      <>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-500">
          {v.focus ? <Star className="h-5 w-5 fill-amber-400" /> : <CheckSquare className="h-5 w-5" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{v.title}</span>
          <span className="block text-xs text-muted">
            Task{v.dueDate ? ` · due ${relativeDay(v.dueDate)}` : ""}
            {v.focus ? " · today's focus" : ""}
            {v.priority === "high" ? " · high" : ""}
          </span>
        </span>
      </>
    );
  }
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

/** Shrink a photo to ≤1600px JPEG so it uploads fast and fits Gemini's limits. */
async function imageToBase64(file: File): Promise<{ data: string; mime: string }> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { data: url.split(",")[1], mime: "image/jpeg" };
}

function QuickMoney({ onScanned }: { onScanned: (v: TransactionInput) => void }) {
  const { toast } = useToast();
  const { data } = useData<{ favourites: Favourite[]; suggestions: FavouriteSuggestion[] }>("/api/favourites");
  const [scanning, setScanning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function scan(file: File) {
    setScanning(true);
    try {
      const img = await imageToBase64(file);
      const r = await api<{ transactions: TransactionInput[] }>("/api/scan", { method: "POST", json: { image: img.data, mimeType: img.mime } });
      onScanned(r.transactions[0]);
      toast({ message: "Read the receipt. Check the details and save" });
    } catch (e) {
      toast({ message: (e as Error).message, tone: "error" });
    } finally {
      setScanning(false);
    }
  }
  async function logFav(f: Favourite) {
    await api(`/api/favourites/${f.id}`, { method: "POST" });
    refreshAll();
    toast({ message: `Logged ${f.label}` });
  }
  const favs = data?.favourites || [];
  return (
    <div className="mb-5 space-y-3">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={scanning}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-3 text-sm font-medium text-muted hover:border-indigo-400 hover:text-fg"
      >
        {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        {scanning ? "Reading receipt…" : "Scan a bill or UPI screenshot"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) scan(f);
          e.target.value = "";
        }}
      />
      {favs.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Favourites: tap to log instantly</p>
          <div className="no-scrollbar -mx-5 flex gap-1.5 overflow-x-auto px-5">
            {favs.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => logFav(f)}
                className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-raised px-3 py-1.5 text-sm hover:border-indigo-400"
              >
                {categoryMeta(f.payload.category).emoji} {f.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ExpensePanel({ id, initial, close }: { id?: string; initial?: TransactionInput; close: () => void }) {
  const { toast, undoable } = useToast();
  const [value, setValue] = useState<TransactionInput>(initial || blankExpense());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [asFavourite, setAsFavourite] = useState(false);
  const { data } = useData<{ usedCategories: { category: string; type: string }[] }>("/api/transactions");
  const extra = (data?.usedCategories || []).filter((c) => c.type === value.type).map((c) => c.category);

  async function save() {
    setSaving(true);
    try {
      if (value.type === "transfer" && (!value.accountId || !value.toAccountId)) throw new Error("Pick both accounts for a transfer");
      if (id) await api(`/api/transactions/${id}`, { method: "PATCH", json: value });
      else await api("/api/transactions", { method: "POST", json: { items: [value] } });
      if (asFavourite && !id) {
        const { date: _date, ...payload } = value;
        void _date;
        await api("/api/favourites", {
          method: "POST",
          json: { label: `${value.note || value.category} ₹${value.amount}`, payload },
        });
      }
      toast({
        message: id
          ? "Entry updated"
          : `${value.type === "income" ? "Income" : value.type === "transfer" ? "Transfer" : "Expense"} added · ${formatINR(Math.round(value.amount * 100))}`,
      });
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
      {!id && <QuickMoney onScanned={(v) => setValue({ ...blankExpense(), ...v })} />}
      <ExpenseEditor
        value={value}
        onChange={(v) => {
          setValue(v);
          setErr(""); // e.g. "Pick both accounts" goes away once you pick them
        }}
        extraCategories={extra}
        autoFocus={!id}
      />
      {!id && value.type !== "transfer" && (
        <label className="mt-4 flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={asFavourite} onChange={(e) => setAsFavourite(e.target.checked)} className="h-4 w-4 accent-indigo-500" />
          Also save as a one-tap favourite
        </label>
      )}
      {id && value.type === "expense" && (
        <button
          type="button"
          onClick={async () => {
            try {
              const r = await api<{ reminder: { title: string; dueAt: string }; existed: boolean }>(`/api/transactions/${id}/remind`, { method: "POST" });
              refreshAll();
              toast({
                message: r.existed
                  ? `You already have a monthly reminder for “${r.reminder.title}”`
                  : `Monthly reminder set · next ${new Date(r.reminder.dueAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
              });
            } catch (e) {
              toast({ message: (e as Error).message, tone: "error" });
            }
          }}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-2.5 text-sm font-medium text-muted hover:bg-raised hover:text-fg"
        >
          <Repeat className="h-4 w-4" /> Remind me about this every month
        </button>
      )}
      {err && <p className="mt-3 text-sm text-rose-500">{err}</p>}
      <PanelActions saving={saving} disabled={!value.amount || value.amount <= 0} onSave={save} onDelete={id ? remove : undefined} />
    </>
  );
}

function TaskPanel({ id, initial, close }: { id?: string; initial?: TaskInput; close: () => void }) {
  const { toast, undoable } = useToast();
  const [value, setValue] = useState<TaskInput>(initial || blankTask());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setSaving(true);
    try {
      if (id) await api(`/api/tasks/${id}`, { method: "PATCH", json: value });
      else await api("/api/tasks", { method: "POST", json: { items: [value] } });
      toast({ message: id ? "Task updated" : value.focus ? "Added to today's focus" : "Task added" });
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
      "Task deleted",
      () => api(`/api/tasks/${id}`, { method: "DELETE" }).then(refreshAll),
      () => unhideId(id),
    );
  }

  return (
    <>
      <TaskEditor value={value} onChange={setValue} autoFocus={!id} onSubmit={() => !saving && value.title.trim() && save()} />
      {err && <p className="mt-3 text-sm text-rose-500">{err}</p>}
      <PanelActions saving={saving} disabled={!value.title.trim()} onSave={save} onDelete={id ? remove : undefined} />
    </>
  );
}
