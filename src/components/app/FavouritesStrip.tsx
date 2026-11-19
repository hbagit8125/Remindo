"use client";

import { Plus, Sparkles } from "lucide-react";
import { api, refreshAll, useData } from "./client";
import { useToast } from "./toast";
import { useSheet } from "./AddSheet";
import { categoryMeta, type Favourite, type FavouriteSuggestion } from "../types";

/** One-tap logging chips on Home, plus "make this a favourite?" suggestions. */
export function FavouritesStrip() {
  const { toast } = useToast();
  const { open } = useSheet();
  const { data } = useData<{ favourites: Favourite[]; suggestions: FavouriteSuggestion[] }>("/api/favourites");
  const favs = data?.favourites || [];
  const sugg = (data?.suggestions || []).slice(0, 2);
  if (!favs.length && !sugg.length) return null;

  async function log(f: Favourite) {
    await api(`/api/favourites/${f.id}`, { method: "POST" });
    refreshAll();
    toast({ message: `Logged ${f.label}` });
  }
  async function remember(s: FavouriteSuggestion) {
    await api("/api/favourites", { method: "POST", json: { label: s.label, payload: s.payload } });
    refreshAll();
    toast({ message: `“${s.label}” is now a one-tap favourite` });
  }

  return (
    <div className="mb-6">
      <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-subtle">Quick log</p>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
        {favs.map((f) => (
          <button
            key={f.id}
            onClick={() => log(f)}
            className="card flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition hover:border-indigo-400 active:scale-95"
          >
            <span>{categoryMeta(f.payload.category).emoji}</span>
            {f.label}
          </button>
        ))}
        {sugg.map((s) => (
          <button
            key={s.label}
            onClick={() => remember(s)}
            title={`You've logged this ${s.count} times recently`}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-indigo-400/60 px-3.5 py-2 text-sm text-indigo-600 dark:text-indigo-300"
          >
            <Sparkles className="h-3.5 w-3.5" /> Save “{s.label}”
          </button>
        ))}
        <button onClick={() => open({ mode: "expense" })} aria-label="Add expense" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line text-muted">
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
