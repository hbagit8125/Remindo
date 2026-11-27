"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import {
  ACCOUNT_META,
  categoryMeta,
  METHOD_LABEL,
  type Account,
  type Method,
  type TransactionInput,
} from "../types";
import { field, label } from "./ReminderEditor";
import { api, useCategories, useData } from "./client";
import { formatINR } from "@/lib/money";
import { useToast } from "./toast";

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
  isNew,
}: {
  value: TransactionInput;
  onChange: (v: TransactionInput) => void;
  extraCategories?: string[];
  autoFocus?: boolean;
  /** New entry: start with the account you used last time. */
  isNew?: boolean;
}) {
  const set = <K extends keyof TransactionInput>(k: K, v: TransactionInput[K]) => onChange({ ...value, [k]: v });
  const { data: acc } = useData<{ accounts: Account[] }>("/api/accounts");
  const accounts = acc?.accounts || [];
  const defaulted = useRef(false);
  useEffect(() => {
    if (!isNew || defaulted.current || !acc || value.type !== "expense") return;
    defaulted.current = true;
    if (value.accountId || value.method) return;
    const last = lastPaidWith();
    if (!last) return;
    const a = acc.accounts.find((x) => x.id === last.accountId);
    if (last.accountId && !a) return;
    onChange({ ...value, accountId: a?.id ?? null, method: a ? methodFor(a, last.method) : last.method });
  }, [isNew, acc, value, onChange]);
  const income = value.type === "income";
  const transfer = value.type === "transfer";
  const catData = useCategories();
  const base = income ? catData.income : catData.expense;
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
            <NewCategory
              type={income ? "income" : "expense"}
              onAdded={(n) => {
                catData.reload();
                set("category", n);
              }}
            />
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
        <div>
          <label className={label}>{income ? "From" : "Where"} (optional)</label>
          <input
            className={field}
            placeholder={income ? "Company / person" : "Shop / app"}
            value={value.merchant || ""}
            onChange={(e) => set("merchant", e.target.value || null)}
          />
        </div>
      )}

      {!transfer && <PaidWith value={value} accounts={accounts} onChange={onChange} />}
    </div>
  );
}

const LAST_KEY = "remindo:paidWith";
const BANK_METHODS: { m: Method; label: string }[] = [
  { m: "upi", label: "UPI" },
  { m: "card", label: "Debit card" },
  { m: "bank", label: "Net banking" },
];

/** The method that goes with an account: credit card → card, cash → cash, bank/wallet → UPI unless you pick another. */
function methodFor(a: Account | undefined, current: Method | null | undefined): Method | null {
  if (!a) return current ?? null;
  if (a.kind === "card") return "card";
  if (a.kind === "cash") return "cash";
  if (a.kind === "wallet") return "upi";
  return current && current !== "cash" ? current : "upi";
}

/** Remember the last "paid with" so the next entry starts there. */
export function rememberPaidWith(v: Pick<TransactionInput, "accountId" | "method">) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ accountId: v.accountId ?? null, method: v.method ?? null }));
  } catch {
    // private mode
  }
}
export function lastPaidWith(): { accountId: string | null; method: Method | null } | null {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) || "null");
  } catch {
    return null;
  }
}

/**
 * One "Paid with" picker: your accounts and cards (and cash). Picking one sets UPI/card for you;
 * for a bank you can switch between UPI, debit card and net banking. The balance (or the card's
 * bill and limit) follows the account you pick.
 */
function PaidWith({ value, accounts, onChange }: { value: TransactionInput; accounts: Account[]; onChange: (v: TransactionInput) => void }) {
  const income = value.type === "income";
  const chip = (on: boolean) =>
    clsx(
      "flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium",
      on ? "border-indigo-400 bg-indigo-500/15 text-indigo-600 dark:text-indigo-200" : "border-line text-muted hover:bg-raised",
    );
  const pick = (accountId: string | null, method: Method | null) => {
    const next = { ...value, accountId, method: income ? null : method };
    onChange(next);
    if (!income) rememberPaidWith(next);
  };
  const selected = accounts.find((a) => a.id === value.accountId);
  const hasCash = accounts.some((a) => a.kind === "cash");
  const list = income ? accounts.filter((a) => a.kind !== "card" || value.accountId === a.id) : accounts;

  if (!accounts.length) {
    // No accounts yet: just the method.
    return income ? null : (
      <div>
        <label className={label}>Paid with (optional)</label>
        <div className="grid grid-cols-4 gap-1">
          {(Object.keys(METHOD_LABEL) as Method[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => pick(null, value.method === m ? null : m)}
              className={clsx(
                "rounded-lg border py-2.5 text-[11px] font-medium",
                value.method === m ? "border-indigo-400 bg-indigo-500/15 text-indigo-600 dark:text-indigo-200" : "border-line text-muted hover:bg-raised",
              )}
            >
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">Add your bank and cards in Money → Accounts to keep balances and card bills right.</p>
      </div>
    );
  }

  return (
    <div>
      <label className={label}>{income ? "Received in" : "Paid with"}</label>
      <div className="flex flex-wrap gap-1.5">
        {list.map((a) => (
          <button key={a.id} type="button" className={chip(value.accountId === a.id)} onClick={() => pick(a.id, methodFor(a, value.method))}>
            {ACCOUNT_META[a.kind].emoji} {a.name}
          </button>
        ))}
        {!income && !hasCash && (
          <button type="button" className={chip(!value.accountId && value.method === "cash")} onClick={() => pick(null, "cash")}>
            💵 Cash
          </button>
        )}
        <button type="button" className={chip(!value.accountId && (income || value.method !== "cash"))} onClick={() => pick(null, null)}>
          Not set
        </button>
      </div>
      {!income && selected?.kind === "bank" && (
        <div className="mt-2 flex w-fit rounded-lg bg-raised p-0.5 text-xs font-medium">
          {BANK_METHODS.map((b) => (
            <button
              key={b.m}
              type="button"
              onClick={() => pick(selected.id, b.m)}
              className={clsx("rounded-md px-2.5 py-1", value.method === b.m ? "bg-surface shadow-sm ring-1 ring-line" : "text-muted")}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
      {!income && selected?.kind === "card" && (
        <p className="mt-1.5 text-xs text-muted">
          💳 Credit card: goes on {selected.name}&apos;s next bill
          {selected.card?.availablePaise != null ? ` · ${formatINR(Math.max(0, selected.card.availablePaise))} limit left` : ""}
        </p>
      )}
      {!income && selected && selected.kind !== "card" && value.amount > 0 && selected.balancePaise - Math.round(value.amount * 100) < 0 && (
        <p className="mt-1.5 text-xs text-amber-600">{selected.name} shows {formatINR(selected.balancePaise)}: this takes it below zero.</p>
      )}
    </div>
  );
}

const EMOJI_CHOICES = ["🏷️", "🐶", "🏋️", "☕", "🍺", "💇", "🧒", "🚗", "🏍️", "📱", "💡", "🎮", "⚽", "🙏", "🧹", "🪴", "💄", "🎓", "🏥", "💰"];

/** "＋ New" chip that turns into a small form for adding your own category. */
function NewCategory({ type, onAdded }: { type: "expense" | "income"; onAdded: (name: string) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🏷️");
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-full border border-dashed border-line px-3 py-1.5 text-xs font-medium text-muted hover:bg-raised hover:text-fg"
      >
        <Plus className="h-3.5 w-3.5" /> New
      </button>
    );
  }
  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ category: { name: string } }>("/api/categories", { method: "POST", json: { name, emoji, type } });
      toast({ message: `Added ${emoji} ${r.category.name}` });
      onAdded(r.category.name);
      setOpen(false);
      setName("");
      setEmoji("🏷️");
    } catch (e) {
      toast({ message: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-1 min-w-0 max-w-full basis-full overflow-hidden rounded-2xl border border-line bg-raised/50 p-3">
      <div className="mb-2 flex flex-wrap gap-1">
        {EMOJI_CHOICES.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => setEmoji(e)}
            className={clsx("grid h-8 w-8 shrink-0 place-items-center rounded-lg text-base", emoji === e ? "bg-surface ring-2 ring-indigo-400" : "hover:bg-surface")}
            aria-label={`Emoji ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          autoFocus
          className={clsx(field, "min-w-0 flex-1")}
          placeholder={type === "income" ? "e.g. Rent received" : "e.g. Pet care"}
          maxLength={30}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" disabled={busy || !name.trim()} onClick={add} className="rounded-xl bg-indigo-500 px-4 text-sm font-semibold text-white disabled:opacity-50">
          Add
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-xl px-2 text-sm text-muted hover:text-fg">
          Cancel
        </button>
      </div>
    </div>
  );
}
