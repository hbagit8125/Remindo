"use client";

import { clsx } from "clsx";
import { ArrowRight } from "lucide-react";
import {
  ACCOUNT_META,
  categoryMeta,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  METHOD_LABEL,
  type Account,
  type Method,
  type TransactionInput,
} from "../types";
import { field, label } from "./ReminderEditor";
import { useData } from "./client";

function AccountChips({
  accounts,
  value,
  onChange,
  allowNone = true,
  exclude,
}: {
  accounts: Account[];
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  allowNone?: boolean;
  exclude?: string | null;
}) {
  const chip = (on: boolean) =>
    clsx(
      "flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium",
      on ? "border-indigo-400 bg-indigo-500/15 text-indigo-600 dark:text-indigo-200" : "border-line text-muted hover:bg-raised",
    );
  return (
    <div className="flex flex-wrap gap-1.5">
      {allowNone && (
        <button type="button" className={chip(!value)} onClick={() => onChange(null)}>
          None
        </button>
      )}
      {accounts
        .filter((a) => a.id !== exclude)
        .map((a) => (
          <button key={a.id} type="button" className={chip(value === a.id)} onClick={() => onChange(a.id)}>
            {ACCOUNT_META[a.kind].emoji} {a.name}
          </button>
        ))}
    </div>
  );
}

/** Editable fields for one expense, income or transfer. */
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
  const { data: acc } = useData<{ accounts: Account[] }>("/api/accounts");
  const accounts = acc?.accounts || [];
  const income = value.type === "income";
  const transfer = value.type === "transfer";
  const base = income ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const cats = [...base, ...extraCategories.filter((c) => !base.includes(c))];
  if (value.category && !cats.includes(value.category) && !transfer) cats.push(value.category);

  return (
    <div className="grid gap-4">
      <div className="flex rounded-xl bg-raised p-1">
        {(["expense", "income", "transfer"] as const).map((t) => (
          <button
            key={t}
            type="button"
            disabled={t === "transfer" && accounts.length < 2}
            title={t === "transfer" && accounts.length < 2 ? "Add two accounts first (Money → Accounts)" : undefined}
            onClick={() =>
              onChange({
                ...value,
                type: t,
                category: t === "transfer" ? "Transfer" : t === value.type ? value.category : "Other",
                toAccountId: t === "transfer" ? value.toAccountId : null,
              })
            }
            className={clsx(
              "flex-1 rounded-lg py-2 text-sm font-medium capitalize transition disabled:opacity-35",
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

      {transfer ? (
        <div className="grid gap-3">
          <div>
            <label className={label}>From</label>
            <AccountChips accounts={accounts} value={value.accountId} onChange={(id) => set("accountId", id)} allowNone={false} />
          </div>
          <div className="flex justify-center text-subtle">
            <ArrowRight className="h-4 w-4 rotate-90" />
          </div>
          <div>
            <label className={label}>To</label>
            <AccountChips
              accounts={accounts}
              value={value.toAccountId}
              onChange={(id) => set("toAccountId", id)}
              allowNone={false}
              exclude={value.accountId}
            />
          </div>
        </div>
      ) : (
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
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>{income ? "Source" : transfer ? "Note" : "What for"}</label>
          <input
            className={field}
            placeholder={income ? "e.g. November salary" : transfer ? "e.g. ATM withdrawal" : "e.g. Lunch"}
            value={value.note || ""}
            onChange={(e) => set("note", e.target.value || null)}
          />
        </div>
        <div>
          <label className={label}>Date</label>
          <input type="date" className={field} value={value.date} onChange={(e) => set("date", e.target.value)} />
        </div>
      </div>

      {!transfer && (
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
      )}

      {!transfer && accounts.length > 0 && (
        <div>
          <label className={label}>Account (optional)</label>
          <AccountChips accounts={accounts} value={value.accountId} onChange={(id) => set("accountId", id)} />
        </div>
      )}
    </div>
  );
}
