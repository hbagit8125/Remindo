"use client";

import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { ChevronLeft, ChevronRight, Download, Plus, Search, Wallet, X } from "lucide-react";
import { monthKey, monthLabel, relativeDay, shiftMonth, useData, useHidden } from "@/components/app/client";
import { Empty, PageTitle, Section, SkeletonList, TxItem, useNow } from "@/components/app/rows";
import { useSheet } from "@/components/app/AddSheet";
import { categoryMeta, type Transaction } from "@/components/types";
import { formatINR, TOTAL_BUDGET } from "@/lib/money";
import { BudgetBar } from "./HomeScreen";

export function MonthSwitcher({ month, setMonth, now }: { month: string; setMonth: (m: string) => void; now: Date }) {
  const isCurrent = month === monthKey(now);
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-line p-0.5">
      <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-raised hover:text-fg">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[7.5rem] text-center text-sm font-medium">{monthLabel(month)}</span>
      <button
        onClick={() => setMonth(shiftMonth(month, 1))}
        disabled={isCurrent}
        aria-label="Next month"
        className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-raised hover:text-fg disabled:opacity-30"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

export function MoneyScreen() {
  const now = useNow();
  const hidden = useHidden();
  const { open } = useSheet();
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const { data, loading } = useData<{ transactions: Transaction[] }>(`/api/transactions?month=${month}`);
  const budgets = useData<{ budgets: Record<string, number> }>("/api/budgets");

  const all = useMemo(() => (data?.transactions || []).filter((t) => !hidden.has(t.id)), [data, hidden]);
  const spent = all.filter((t) => t.type === "expense").reduce((s, t) => s + t.amountPaise, 0);
  const income = all.filter((t) => t.type === "income").reduce((s, t) => s + t.amountPaise, 0);
  const limit = budgets.data?.budgets[TOTAL_BUDGET];
  const cats = [...new Set(all.map((t) => t.category))];

  const filtered = all.filter((t) => {
    if (cat && t.category !== cat) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return [t.note, t.merchant, t.category, String(t.amountPaise / 100)].some((v) => v?.toLowerCase().includes(q));
  });

  const groups = new Map<string, Transaction[]>();
  for (const t of filtered) groups.set(t.date, [...(groups.get(t.date) || []), t]);

  return (
    <div>
      <PageTitle
        title="Money"
        subtitle={<span className="md:hidden">Swipe left on an entry to delete</span>}
        right={
          <button
            onClick={() => open({ mode: "expense" })}
            className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-raised"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        }
      />

      <div className="mb-4 flex items-center justify-between gap-2">
        <MonthSwitcher month={month} setMonth={setMonth} now={now} />
          <a download href="/api/transactions/export" className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-muted hover:bg-raised hover:text-fg">
          <Download className="h-4 w-4" /> <span className="hidden sm:inline">Export CSV</span>
        </a>
      </div>

      <div className="card mb-5 rounded-3xl p-5">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs font-medium text-muted">Spent</p>
            <p className="mt-1 text-xl font-semibold tabular-nums md:text-2xl">{formatINR(spent)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted">Income</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-500 md:text-2xl">{formatINR(income)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted">Left</p>
            <p className={clsx("mt-1 text-xl font-semibold tabular-nums md:text-2xl", income - spent < 0 && "text-rose-500")}>
              {income ? formatINR(income - spent) : "—"}
            </p>
          </div>
        </div>
        {limit ? (
          <div className="mt-4">
            <div className="mb-1.5 flex justify-between text-xs text-muted">
              <span>Budget {formatINR(limit)}</span>
              <span>{spent <= limit ? `${formatINR(limit - spent)} left` : `${formatINR(spent - limit)} over`}</span>
            </div>
            <BudgetBar spent={spent} limit={limit} />
          </div>
        ) : null}
      </div>

      {all.length > 0 && (
        <div className="mb-4 space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes, shops, amounts"
              className="w-full rounded-xl border border-line bg-surface py-2.5 pl-10 pr-9 text-sm outline-none placeholder:text-subtle focus:border-indigo-400"
            />
            {query && (
              <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-subtle" aria-label="Clear">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {cats.length > 1 && (
            <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
              <button
                onClick={() => setCat(null)}
                className={clsx("shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium", !cat ? "border-fg bg-fg text-[var(--bg)]" : "border-line text-muted")}
              >
                All
              </button>
              {cats.map((c) => (
                <button
                  key={c}
                  onClick={() => setCat(cat === c ? null : c)}
                  className={clsx(
                    "flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium",
                    cat === c ? "border-fg bg-fg text-[var(--bg)]" : "border-line text-muted",
                  )}
                >
                  {categoryMeta(c).emoji} {c}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <SkeletonList />
      ) : !all.length ? (
        <Empty
          icon={<Wallet className="h-6 w-6" />}
          title={`Nothing logged for ${monthLabel(month)}`}
          text="Tap + and say “Spent 200 on coffee” or add it manually."
          action={
            <button onClick={() => open({ mode: "expense" })} className="rounded-xl bg-fg px-4 py-2 text-sm font-semibold text-[var(--bg)]">
              Add expense
            </button>
          }
        />
      ) : !filtered.length ? (
        <p className="py-10 text-center text-sm text-muted">No matches.</p>
      ) : (
        [...groups.entries()].map(([date, list]) => {
          const dayTotal = list.filter((t) => t.type === "expense").reduce((s, t) => s + t.amountPaise, 0);
          return (
            <Section key={date} title={relativeDay(date, now)} right={dayTotal ? formatINR(dayTotal) : undefined}>
              {list.map((t) => (
                <TxItem key={t.id} t={t} />
              ))}
            </Section>
          );
        })
      )}
    </div>
  );
}
