"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import { api, refreshAll, useCategories } from "./client";
import { useToast } from "./toast";
import { categoryMeta } from "../types";
import { formatINR, TOTAL_BUDGET } from "@/lib/money";

const PRESETS = [10000, 20000, 30000, 50000];

/**
 * Bottom sheet for monthly budgets: one big overall amount, with optional
 * per-category limits tucked behind a toggle.
 */
export function BudgetSheet({
  initial,
  spentByCategory,
  onClose,
}: {
  initial: Record<string, number>;
  spentByCategory: { category: string; amount: number }[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [total, setTotal] = useState(initial[TOTAL_BUDGET] ? String(initial[TOTAL_BUDGET] / 100) : "");
  const [cats, setCats] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initial).filter(([k]) => k !== TOTAL_BUDGET).map(([k, v]) => [k, String(v / 100)])),
  );
  const [showCats, setShowCats] = useState(Object.keys(cats).length > 0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const { expense: allCats } = useCategories();
  // Categories you've spent on come first, then the rest.
  const spent = new Map(spentByCategory.map((c) => [c.category, c.amount]));
  const list = [...new Set([...spentByCategory.map((c) => c.category), ...Object.keys(cats), ...allCats])];
  const catSum = Object.values(cats).reduce((s, v) => s + (Number(v) || 0), 0);
  const totalNum = Number(total) || 0;
  const hasAny = Object.keys(initial).length > 0;

  async function save(clear = false) {
    setSaving(true);
    const budgets: Record<string, number> = clear
      ? {}
      : { [TOTAL_BUDGET]: totalNum, ...Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, Number(v) || 0])) };
    try {
      await api("/api/budgets", { method: "PUT", json: { budgets } });
      toast({ message: clear ? "Budget removed" : "Budget saved" });
      refreshAll();
      onClose();
    } catch (e) {
      toast({ message: (e as Error).message, tone: "error" });
      setSaving(false);
    }
  }

  return (
    <div className="animate-fade fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm md:items-center md:p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-sheet pb-safe max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-line bg-[var(--bg)] md:max-w-md md:rounded-3xl"
      >
        <div className="px-5 pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--line)] md:hidden" />
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Monthly budget</h2>
            <button onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-raised">
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="text-sm text-muted">How much do you want to spend in a month? You&apos;ll get an email at 80% and 100%.</p>
        </div>

        <div className="px-5 pb-6">
          {/* Overall amount */}
          <div className="mt-6 flex items-baseline justify-center gap-1">
            <span className="text-3xl font-semibold text-muted">₹</span>
            <input
              type="number"
              inputMode="numeric"
              autoFocus={!hasAny}
              placeholder="30000"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              className="w-52 bg-transparent text-center text-5xl font-semibold tracking-tight outline-none placeholder:text-subtle"
            />
          </div>
          <p className="mt-1 text-center text-xs text-subtle">{totalNum ? `${formatINR(totalNum * 100)} a month` : "per month"}</p>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setTotal(String(p))}
                className={clsx(
                  "rounded-xl border py-2 text-sm font-medium transition",
                  totalNum === p ? "border-indigo-400 bg-indigo-500/15 text-indigo-600 dark:text-indigo-200" : "border-line text-muted hover:bg-raised",
                )}
              >
                {p / 1000}k
              </button>
            ))}
          </div>

          {/* Category limits (optional) */}
          <button
            onClick={() => setShowCats(!showCats)}
            className="mt-6 flex w-full items-center justify-between rounded-2xl border border-line px-4 py-3 text-left hover:bg-raised"
          >
            <span>
              <span className="block text-sm font-medium">Limits per category</span>
              <span className="block text-xs text-muted">
                {Object.values(cats).filter((v) => Number(v) > 0).length
                  ? `${Object.values(cats).filter((v) => Number(v) > 0).length} set · ${formatINR(catSum * 100)}`
                  : "Optional, e.g. Food ₹5,000"}
              </span>
            </span>
            <ChevronDown className={clsx("h-4 w-4 text-subtle transition", showCats && "rotate-180")} />
          </button>

          {showCats && (
            <div className="mt-2 space-y-1">
              {totalNum > 0 && catSum > totalNum && (
                <p className="px-1 pb-1 text-xs text-amber-600 dark:text-amber-400">
                  Category limits add up to more than your monthly budget.
                </p>
              )}
              {list.map((c) => {
                const m = categoryMeta(c);
                const s = spent.get(c);
                return (
                  <div key={c} className="flex items-center gap-3 rounded-xl px-1 py-1.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: `${m.color}22` }}>
                      {m.emoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">{c}</span>
                      {s ? <span className="block text-[11px] text-subtle">{formatINR(s)} spent this month</span> : null}
                    </span>
                    <div className="relative w-28">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-subtle">₹</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        placeholder="No limit"
                        value={cats[c] ?? ""}
                        onChange={(e) => setCats({ ...cats, [c]: e.target.value })}
                        className="w-full rounded-xl border border-line bg-raised py-2 pl-7 pr-2 text-right text-sm tabular-nums outline-none placeholder:text-xs placeholder:text-subtle focus:border-indigo-400"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="sticky bottom-0 -mx-5 mt-4 border-t border-line bg-[var(--bg)] px-5 pb-2 pt-4">
          <button
            onClick={() => save()}
            disabled={saving || (!totalNum && !catSum)}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-fg text-sm font-semibold text-[var(--bg)] hover:opacity-90 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save budget
          </button>
          {hasAny && (
            <button onClick={() => save(true)} disabled={saving} className="mt-2 w-full py-2 text-sm text-rose-500 hover:underline">
              Remove all budgets
            </button>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
