"use client";

import { Lightbulb, X } from "lucide-react";
import { api, refreshAll, useData } from "./client";
import { useToast } from "./toast";

type Suggestion = { key: string; title: string; body: string; cta: string };

/** "You usually pay electricity around the 10th — add a reminder?" cards on Home. */
export function SuggestionCards() {
  const { toast } = useToast();
  const { data, setData } = useData<{ suggestions: Suggestion[] }>("/api/suggestions");
  const list = data?.suggestions || [];
  if (!list.length) return null;
  const act = async (s: Suggestion, action: "accept" | "dismiss") => {
    setData({ suggestions: list.filter((x) => x.key !== s.key) });
    try {
      await api("/api/suggestions", { method: "POST", json: { key: s.key, action } });
      if (action === "accept") {
        toast({ message: "Done ✓" });
        refreshAll();
      }
    } catch (e) {
      toast({ message: (e as Error).message, tone: "error" });
    }
  };
  return (
    <div className="mb-6 space-y-2">
      {list.map((s) => (
        <div key={s.key} className="animate-pop flex gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4">
          <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{s.title}</p>
            <p className="mt-0.5 text-sm text-muted">{s.body}</p>
            <button onClick={() => act(s, "accept")} className="mt-2 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white">
              {s.cta}
            </button>
          </div>
          <button onClick={() => act(s, "dismiss")} aria-label="Dismiss" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-black/5">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
