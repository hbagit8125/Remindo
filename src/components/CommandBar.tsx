"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { Check, Loader2, Mic, MicOff, Sparkles, Trash2, X } from "lucide-react";
import { ReminderEditor } from "./ReminderEditor";
import type { ReminderInput } from "./types";

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

const EXAMPLES = [
  "Pay rent on the 5th every month, remind me 2 days early",
  "Call mom tomorrow at 7pm",
  "Ammu's birthday on March 3",
  "Gym at 6:30am every Mon, Wed and Fri",
];

export function CommandBar({ onCreated }: { onCreated: () => void }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<ReminderInput[]>([]);
  const [note, setNote] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceOk, setVoiceOk] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);

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
      setText(t);
    };
    rec.onend = () => setListening(false);
    rec.onerror = (e) => {
      setListening(false);
      if (e.error === "not-allowed") setNote("Microphone permission was denied.");
    };
    recRef.current = rec;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- feature detection runs once on mount
    setVoiceOk(true);
  }, []);

  function toggleMic() {
    if (!recRef.current) return;
    if (listening) {
      recRef.current.stop();
      return;
    }
    setText("");
    setNote("");
    setListening(true);
    recRef.current.start();
  }

  async function parse(input = text) {
    if (!input.trim()) return;
    setLoading(true);
    setNote("");
    const res = await fetch("/api/parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: input }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) return setNote(json.error || "Couldn't understand that");
    setDrafts(json.items);
    if (json.warning) setNote(json.warning);
  }

  // When voice input finishes, parse it straight away.
  const prevListening = useRef(false);
  useEffect(() => {
    if (prevListening.current && !listening && text.trim()) parse(text);
    prevListening.current = listening;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);

  async function saveAll() {
    setSaving(true);
    const res = await fetch("/api/reminders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: drafts }),
    });
    setSaving(false);
    if (!res.ok) return setNote((await res.json()).error || "Couldn't save");
    setDrafts([]);
    setText("");
    setNote("");
    onCreated();
  }

  return (
    <section className="glass rounded-3xl p-4 sm:p-5">
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <Sparkles className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-indigo-300" />
          <textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                parse();
              }
            }}
            placeholder={listening ? "Listening…" : "What should I remember?"}
            className="max-h-40 min-h-[48px] w-full resize-none rounded-2xl border border-white/10 bg-black/20 py-3 pl-9 pr-3 text-[15px] text-white outline-none placeholder:text-zinc-500 focus:border-indigo-400"
          />
        </div>
        {voiceOk && (
          <button
            onClick={toggleMic}
            title="Speak"
            className={clsx(
              "grid h-12 w-12 shrink-0 place-items-center rounded-2xl border transition",
              listening ? "listening border-rose-400 bg-rose-500 text-white" : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10",
            )}
          >
            {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
        )}
        <button
          onClick={() => parse()}
          disabled={loading || !text.trim()}
          className="grid h-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:brightness-110 disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Add"}
        </button>
      </div>

      {!drafts.length && !text && (
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setText(ex)}
              className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-400 transition hover:border-indigo-400/50 hover:text-zinc-200"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {note && <p className="mt-3 text-sm text-amber-300/90">{note}</p>}

      {drafts.length > 0 && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-zinc-400">
            Here&apos;s what I understood. Check it, then save{drafts.length > 1 ? ` all ${drafts.length}` : ""}.
          </p>
          {drafts.map((d, i) => (
            <div key={i} className="relative rounded-2xl border border-indigo-400/20 bg-indigo-500/5 p-4">
              <button
                onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}
                className="absolute right-3 top-3 text-zinc-500 hover:text-rose-400"
                title="Remove"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <ReminderEditor value={d} onChange={(v) => setDrafts(drafts.map((x, j) => (j === i ? v : x)))} />
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setDrafts([])}
              className="flex items-center gap-1 rounded-xl px-4 py-2 text-sm text-zinc-400 hover:bg-white/5"
            >
              <X className="h-4 w-4" /> Discard
            </button>
            <button
              onClick={saveAll}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
