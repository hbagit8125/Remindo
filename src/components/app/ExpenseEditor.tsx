"use client";

import { clsx } from "clsx";
import { categoryMeta, EXPENSE_CATEGORIES, INCOME_CATEGORIES, METHOD_LABEL, type Method, type TransactionInput } from "../types";
import { field, label } from "./ReminderEditor";

/** Editable fields for one expense or income entry. */
export function ExpenseEditor({
  value,
  onChange,
  extraCategories = [],
  autoFocus,
}: {
  value: TransactionInput;
  onChange: (v: TransactionInput) => void;
  extraCategories?: string[];
  autoFocus?: boolean;
}) {
  const set = <K extends keyof TransactionInput>(k: K, v: TransactionInput[K]) => onChange({ ...value, [k]: v });
  const base = value.type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const cats = [...base, ...extraCategories.filter((c) => !base.includes(c))];
  if (value.category && !cats.includes(value.category)) cats.push(value.category);
  const income = value.type === "income";

  return (
    <div className="grid gap-4">
      <div className="flex rounded-xl bg-raised p-1">
        {(["expense", "income"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange({ ...value, type: t, category: t === value.type ? value.category : "Other" })}
            className={clsx(
              "flex-1 rounded-lg py-2 text-sm font-medium capitalize transition",
              value.type === t ? "bg-surface text-fg shadow-sm ring-1 ring-line" : "text-muted",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex items-baseline justify-center gap-1 py-1">
        <span className={clsx("text-3xl font-semibold", income ? "text-emerald-500" : "text-muted")}>₹</span>
        <input
          type="number"
          inputMode="decimal"
          autoFocus={autoFocus}
          placeholder="0"
          value={value.amount || ""}
          onChange={(e) => set("amount", Number(e.target.value) || 0)}
          className={clsx(
            "w-48 bg-transparent text-center text-5xl font-semibold tracking-tight outline-none placeholder:text-subtle",
            income ? "text-emerald-500" : "text-fg",
          )}
        />
      </div>

      <div>
        <label className={label}>Category</label>
        <div className="no-scrollbar -mx-1 flex flex-wrap gap-1.5 px-1">
          {cats.map((c) => {
            const m = categoryMeta(c);
            const on = value.category === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => set("category", c)}
                className={clsx(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                  on ? "text-fg" : "border-line text-muted hover:bg-raised",
                )}
                style={on ? { borderColor: m.color, background: `${m.color}22` } : undefined}
              >
                <span>{m.emoji}</span>
                {c}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>{income ? "Source" : "What for"}</label>
          <input
            className={field}
            placeholder={income ? "e.g. November salary" : "e.g. Lunch"}
            value={value.note || ""}
            onChange={(e) => set("note", e.target.value || null)}
          />
        </div>
        <div>
          <label className={label}>Date</label>
          <input type="date" className={field} value={value.date} onChange={(e) => set("date", e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>{income ? "From" : "Where"} (optional)</label>
          <input
            className={field}
            placeholder={income ? "Company" : "Shop / app"}
            value={value.merchant || ""}
            onChange={(e) => set("merchant", e.target.value || null)}
          />
        </div>
        <div>
          <label className={label}>Paid with (optional)</label>
          <div className="grid grid-cols-4 gap-1">
            {(Object.keys(METHOD_LABEL) as Method[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => set("method", value.method === m ? null : m)}
                className={clsx(
                  "rounded-lg border py-2.5 text-[11px] font-medium",
                  value.method === m
                    ? "border-indigo-400 bg-indigo-500/15 text-indigo-600 dark:text-indigo-200"
                    : "border-line text-muted hover:bg-raised",
                )}
              >
                {METHOD_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
