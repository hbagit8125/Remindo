"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Download, Loader2, PieChart, Target, TrendingDown, TrendingUp } from "lucide-react";
import { api, monthKey, monthLabel, refreshAll, useData } from "@/components/app/client";
import { Empty, PageTitle, Section, useNow } from "@/components/app/rows";
import { useToast } from "@/components/app/toast";
import { categoryMeta, EXPENSE_CATEGORIES, type Insights } from "@/components/types";
import { formatINR, TOTAL_BUDGET } from "@/lib/money";
import { BudgetBar } from "./HomeScreen";
import { MonthSwitcher } from "./MoneyScreen";

export function InsightsScreen() {
  const now = useNow();
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [editing, setEditing] = useState(false);
  const { data } = useData<Insights>(`/api/insights?month=${month}`);

  const change = data && data.prevSpent ? ((data.spent - data.prevSpent) / data.prevSpent) * 100 : null;
  const limit = data?.budgets[TOTAL_BUDGET];

  return (
    <div>
      <PageTitle
        title="Insights"
        right={
          <a download href="/api/transactions/export" className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-muted hover:bg-raised hover:text-fg">
            <Download className="h-4 w-4" /> <span className="hidden sm:inline">Export</span>
          </a>
        }
      />
      <div className="mb-5">
        <MonthSwitcher month={month} setMonth={setMonth} now={now} />
      </div>

      {!data ? (
        <div className="space-y-3">
          <div className="skeleton h-32 rounded-3xl" />
          <div className="skeleton h-64 rounded-3xl" />
        </div>
      ) : (
        <>
          {/* Headline */}
          <div className="card mb-5 rounded-3xl p-5">
            <p className="text-sm text-muted">Spent in {monthLabel(month)}</p>
            <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
              <p className="text-4xl font-semibold tracking-tight tabular-nums">{formatINR(data.spent)}</p>
              {change !== null && (
                <span
                  className={clsx(
                    "mb-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                    change > 0 ? "bg-rose-500/15 text-rose-600 dark:text-rose-300" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
                  )}
                >
                  {change > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                  {Math.abs(Math.round(change))}% vs last month
                </span>
              )}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <Stat label="Income" value={formatINR(data.income)} tone="good" />
              <Stat label="Saved" value={data.income ? formatINR(data.income - data.spent) : "—"} tone={data.income - data.spent < 0 ? "bad" : undefined} />
              <Stat label="Daily avg" value={formatINR(Math.round(data.spent / daysElapsed(month, now) / 100) * 100)} />
            </div>
            {limit ? (
              <div className="mt-4">
                <div className="mb-1.5 flex justify-between text-xs text-muted">
                  <span>Monthly budget {formatINR(limit)}</span>
                  <span>{Math.round((data.spent / limit) * 100)}%</span>
                </div>
                <BudgetBar spent={data.spent} limit={limit} />
              </div>
            ) : null}
          </div>

          {!data.spent ? (
            <Empty icon={<PieChart className="h-6 w-6" />} title="No spending yet" text="Charts appear once you log some expenses this month." />
          ) : (
            <div className="md:grid md:grid-cols-2 md:gap-5">
              <Section title="Where it went">
                <div className="card rounded-3xl p-5">
                  <Donut data={data.byCategory} total={data.spent} />
                  <div className="mt-5 space-y-3">
                    {data.byCategory.map((c) => {
                      const m = categoryMeta(c.category);
                      const b = data.budgets[c.category];
                      const prev = data.prevByCategory.find((p) => p.category === c.category)?.amount || 0;
                      return (
                        <div key={c.category}>
                          <div className="flex items-center gap-2 text-sm">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />
                            <span className="flex-1">
                              {m.emoji} {c.category}
                            </span>
                            <span className="text-xs text-subtle">{Math.round((c.amount / data.spent) * 100)}%</span>
                            <span className="w-24 text-right font-medium tabular-nums">{formatINR(c.amount)}</span>
                          </div>
                          {b ? (
                            <div className="mt-1.5 flex items-center gap-2 pl-[18px]">
                              <BudgetBar spent={c.amount} limit={b} className="flex-1" />
                              <span className="text-[11px] text-subtle">of {formatINR(b)}</span>
                            </div>
                          ) : prev ? (
                            <p className="pl-[18px] text-[11px] text-subtle">Last month {formatINR(prev)}</p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Section>
              <Section title="Day by day">
                <div className="card rounded-3xl p-5">
                  <DailyBars month={month} byDay={data.byDay} />
                </div>
              </Section>
            </div>
          )}

          <Section
            title="Budgets"
            right={
              !editing && (
                <button onClick={() => setEditing(true)} className="text-indigo-500">
                  {Object.keys(data.budgets).length ? "Edit" : "Set up"}
                </button>
              )
            }
          >
            {editing ? (
              <BudgetEditor initial={data.budgets} categories={data.byCategory.map((c) => c.category)} onDone={() => setEditing(false)} />
            ) : Object.keys(data.budgets).length ? (
              <div className="card rounded-3xl p-5 text-sm text-muted">
                <Target className="mb-2 h-5 w-5 text-indigo-500" />
                {limit ? `Overall ${formatINR(limit)} a month` : "No overall limit"}
                {Object.keys(data.budgets).filter((k) => k !== TOTAL_BUDGET).length
                  ? ` · ${Object.keys(data.budgets).filter((k) => k !== TOTAL_BUDGET).length} category limits`
                  : ""}
                . You&apos;ll get an email at 80% and 100%.
              </div>
            ) : (
              <button onClick={() => setEditing(true)} className="card w-full rounded-3xl p-5 text-left text-sm text-muted hover:bg-raised">
                <Target className="mb-2 h-5 w-5 text-indigo-500" />
                Set a monthly budget and Remindo will email you when you reach 80% and 100%.
              </button>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function daysElapsed(month: string, now: Date) {
  if (month === monthKey(now)) return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric" }).format(now));
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-2xl bg-raised p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={clsx("mt-0.5 font-semibold tabular-nums", tone === "good" && "text-emerald-500", tone === "bad" && "text-rose-500")}>{value}</p>
    </div>
  );
}

function Donut({ data, total }: { data: { category: string; amount: number }[]; total: number }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const [hover, setHover] = useState<string | null>(null);
  const segs = data.reduce<{ category: string; amount: number; len: number; offset: number }[]>((acc, d) => {
    const prev = acc.at(-1);
    const offset = prev ? prev.offset + prev.len : 0;
    return [...acc, { ...d, len: (d.amount / total) * c, offset }];
  }, []);
  const active = data.find((d) => d.category === hover);
  return (
    <div className="relative mx-auto h-48 w-48">
      <svg viewBox="0 0 180 180" className="h-full w-full -rotate-90">
        <circle cx="90" cy="90" r={r} fill="none" stroke="var(--raised)" strokeWidth="22" />
        {segs.map((s) => (
          <circle
            key={s.category}
            cx="90"
            cy="90"
            r={r}
            fill="none"
            stroke={categoryMeta(s.category).color}
            strokeWidth={hover === s.category ? 26 : 22}
            strokeDasharray={`${Math.max(0, s.len - 1.5)} ${c}`}
            strokeDashoffset={-s.offset}
            onMouseEnter={() => setHover(s.category)}
            onMouseLeave={() => setHover(null)}
            className="cursor-pointer transition-all"
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-xs text-muted">{active ? active.category : "Total"}</span>
        <span className="text-lg font-semibold tabular-nums">{formatINR(active ? active.amount : total)}</span>
      </div>
    </div>
  );
}

function DailyBars({ month, byDay }: { month: string; byDay: { date: string; amount: number }[] }) {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const map = new Map(byDay.map((d) => [Number(d.date.slice(8)), d.amount]));
  const max = Math.max(1, ...byDay.map((d) => d.amount));
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return (
    <div>
      <div className="mb-3 h-10">
        {shown ? (
          <>
            <p className="text-xs text-muted">
              {hover ? `${shown} ${monthLabel(month).split(" ")[0]}` : `Biggest day · ${shown} ${monthLabel(month).split(" ")[0]}`}
            </p>
            <p className="font-semibold tabular-nums">{formatINR(map.get(shown) || 0)}</p>
          </>
        ) : null}
      </div>
      <div className="flex h-36 items-end gap-[3px]" onMouseLeave={() => setHover(null)}>
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
          const v = map.get(d) || 0;
          return (
            <div key={d} className="flex h-full flex-1 items-end" onMouseEnter={() => setHover(d)} onClick={() => setHover(d)}>
              <div
                className={clsx("w-full rounded-t-[3px] transition-colors", v ? (hover === d ? "bg-indigo-400" : "bg-indigo-500") : "bg-raised")}
                style={{ height: v ? `${Math.max(4, (v / max) * 100)}%` : "3px" }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-subtle">
        <span>1</span>
        <span>{Math.ceil(days / 2)}</span>
        <span>{days}</span>
      </div>
    </div>
  );
}

function BudgetEditor({ initial, categories, onDone }: { initial: Record<string, number>; categories: string[]; onDone: () => void }) {
  const { toast } = useToast();
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, String(v / 100)])),
  );
  const [saving, setSaving] = useState(false);
  const list = [...new Set([...categories, ...Object.keys(initial).filter((k) => k !== TOTAL_BUDGET), ...EXPENSE_CATEGORIES])];

  async function save() {
    setSaving(true);
    try {
      await api("/api/budgets", {
        method: "PUT",
        json: { budgets: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, Number(v) || 0])) },
      });
      toast({ message: "Budgets saved" });
      refreshAll();
      onDone();
    } catch (e) {
      toast({ message: (e as Error).message, tone: "error" });
      setSaving(false);
    }
  }

  const input = (k: string, placeholder: string) => (
    <div className="relative w-32">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">₹</span>
      <input
        type="number"
        inputMode="numeric"
        placeholder={placeholder}
        value={vals[k] ?? ""}
        onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
        className="w-full rounded-xl border border-line bg-raised py-2 pl-7 pr-2 text-right text-sm tabular-nums outline-none focus:border-indigo-400"
      />
    </div>
  );

  return (
    <div className="card rounded-3xl p-5">
      <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="font-medium">Overall monthly budget</p>
          <p className="text-xs text-muted">Leave empty for no limit</p>
        </div>
        {input(TOTAL_BUDGET, "30000")}
      </div>
      <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wider text-subtle">Per category (optional)</p>
      <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
        {list.map((c) => (
          <div key={c} className="flex items-center justify-between gap-3">
            <span className="text-sm">
              {categoryMeta(c).emoji} {c}
            </span>
            {input(c, "—")}
          </div>
        ))}
      </div>
      <div className="mt-5 flex gap-2">
        <button onClick={onDone} className="flex-1 rounded-xl border border-line py-2.5 text-sm text-muted hover:bg-raised">
          Cancel
        </button>
        <button onClick={save} disabled={saving} className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-fg py-2.5 text-sm font-semibold text-[var(--bg)] disabled:opacity-50">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save budgets
        </button>
      </div>
    </div>
  );
}
