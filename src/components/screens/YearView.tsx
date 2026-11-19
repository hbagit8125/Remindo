"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useData } from "@/components/app/client";
import { Section } from "@/components/app/rows";
import { categoryMeta, type YearInsights } from "@/components/types";
import { formatINR } from "@/lib/money";

const M = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 12-month view: spend vs income per month, and top category trends. */
export function YearView() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const { data } = useData<YearInsights>(`/api/insights/year?year=${year}`);
  const [hover, setHover] = useState<number | null>(null);
  const thisYear = new Date().getFullYear();

  if (!data) return <div className="skeleton h-72 rounded-3xl" />;
  const max = Math.max(1, ...data.months.map((m) => Math.max(m.spent, m.income)));
  const activeMonths = data.months.filter((m) => m.spent > 0).length || 1;
  const shown = hover ?? data.months.reduce((best, m, i) => (m.spent > data.months[best].spent ? i : best), 0);

  return (
    <>
      <div className="mb-4 inline-flex items-center gap-1 rounded-xl border border-line p-0.5">
        <button onClick={() => setYear(year - 1)} aria-label="Previous year" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-raised">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[4rem] text-center text-sm font-medium">{year}</span>
        <button onClick={() => setYear(year + 1)} disabled={year >= thisYear} aria-label="Next year" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-raised disabled:opacity-30">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="card mb-5 rounded-3xl p-5">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-muted">Spent</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatINR(data.spent)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Income</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-500">{formatINR(data.income)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Avg / month</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatINR(Math.round(data.spent / activeMonths / 100) * 100)}</p>
          </div>
        </div>

        <div className="mt-5 h-10 text-sm">
          <span className="text-muted">{MONTH_NAMES[shown]} </span>
          <b>{formatINR(data.months[shown].spent)}</b> spent
          {data.months[shown].income ? <span className="text-emerald-500"> · {formatINR(data.months[shown].income)} in</span> : null}
        </div>
        <div className="flex h-40 items-end gap-1.5" onMouseLeave={() => setHover(null)}>
          {data.months.map((m, i) => (
            <button key={m.month} onClick={() => setHover(i)} onMouseEnter={() => setHover(i)} className="flex h-full flex-1 items-end justify-center gap-[2px]">
              <span className={clsx("w-1/2 rounded-t-[3px]", i === shown ? "bg-indigo-400" : "bg-indigo-500")} style={{ height: m.spent ? `${Math.max(3, (m.spent / max) * 100)}%` : "3px", opacity: m.spent ? 1 : 0.25 }} />
              {data.income > 0 && <span className="w-1/3 rounded-t-[3px] bg-emerald-500/70" style={{ height: m.income ? `${Math.max(3, (m.income / max) * 100)}%` : "0" }} />}
            </button>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5 text-center text-[10px] text-subtle">
          {M.map((x, i) => (
            <span key={i} className="flex-1">
              {x}
            </span>
          ))}
        </div>
        {data.income > 0 && (
          <div className="mt-3 flex gap-4 text-[11px] text-muted">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-indigo-500" /> spent
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-emerald-500/70" /> income
            </span>
          </div>
        )}
      </div>

      {data.topCategories.length > 0 && (
        <Section title="Top categories this year">
          <div className="card space-y-4 rounded-3xl p-5">
            {data.topCategories.map((c) => {
              const m = categoryMeta(c.category);
              const cmax = Math.max(1, ...c.months);
              return (
                <div key={c.category} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-sm">
                    {m.emoji} {c.category}
                  </span>
                  <span className="flex h-8 flex-1 items-end gap-[2px]">
                    {c.months.map((v, i) => (
                      <span key={i} className="flex-1 rounded-t-sm" style={{ height: v ? `${Math.max(8, (v / cmax) * 100)}%` : "2px", background: v ? m.color : "var(--raised)" }} />
                    ))}
                  </span>
                  <span className="w-20 shrink-0 text-right text-sm font-medium tabular-nums">{formatINR(c.total)}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </>
  );
}
