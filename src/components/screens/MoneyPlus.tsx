"use client";

import { dueShareText, ShareButton } from "@/components/app/Share";
import { useState } from "react";
import { clsx } from "clsx";
import { ArrowLeftRight, Check, Handshake, Loader2, Pencil, PiggyBank, Plus, Trash2, Wallet, X } from "lucide-react";
import { api, refreshAll, relativeDay, useData, useHidden, hideId, unhideId } from "@/components/app/client";
import { Empty, PageTitle, Section, SkeletonList } from "@/components/app/rows";
import { MoneyTabs } from "@/components/app/MoneyTabs";
import { useToast } from "@/components/app/toast";
import { useSheet } from "@/components/app/AddSheet";
import { field, label } from "@/components/app/ReminderEditor";
import { ACCOUNT_META, type Account, type AccountKind, type Due, type Goal } from "@/components/types";
import { formatINR } from "@/lib/money";


export const primaryBtn = "flex items-center justify-center gap-2 rounded-xl bg-fg px-4 py-2.5 text-sm font-semibold text-[var(--bg)] hover:opacity-90 disabled:opacity-40";
export const ghostBtn = "rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-raised";

/** Small modal used by the forms on these screens. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="animate-fade fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm md:items-center md:p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Enter in a text box saves (clicks the form's main button), like a normal form.
          const t = e.target as HTMLElement;
          if (e.key !== "Enter" || e.nativeEvent.isComposing || t.tagName !== "INPUT") return;
          const btn = e.currentTarget.querySelector<HTMLButtonElement>("button[data-submit]:not(:disabled)");
          if (btn) {
            e.preventDefault();
            btn.click();
          }
        }}
        className="animate-sheet pb-safe max-h-[92vh] max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-3xl border border-line bg-[var(--bg)] p-5 md:max-w-md md:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-raised">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function useSubmit() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      toast({ message: ok });
      refreshAll();
      after?.();
    } catch (e) {
      toast({ message: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

// ------------------------------------------------------------- Accounts

export function AccountsScreen() {
  const { open } = useSheet();
  const { data, loading } = useData<{ accounts: Account[] }>("/api/accounts");
  const [editing, setEditing] = useState<Partial<Account> | null>(null);
  const accounts = data?.accounts || [];
  const money = accounts.filter((a) => a.kind !== "card");
  const cards = accounts.filter((a) => a.kind === "card");
  const total = money.reduce((s, a) => s + a.balancePaise, 0);
  const owed = cards.reduce((s, a) => s + Math.max(0, a.card?.outstandingPaise ?? -a.balancePaise), 0);
  const dueSoon = cards.filter((a) => a.card && (a.card.status === "due" || a.card.status === "overdue"));
  const today = new Date().toLocaleDateString("en-CA");

  /** Pay a card bill: a transfer from your bank to the card (not counted as spending again). */
  const payBill = (c: Account) => {
    const from = money.find((a) => a.id === c.payFromId) || money.find((a) => a.kind === "bank") || money[0];
    const amount = (c.card?.duePaise || Math.max(0, c.card?.outstandingPaise || 0)) / 100;
    open({ mode: "expense", value: { type: "transfer", amount, category: "Transfer", note: `${c.name} bill`, date: today, accountId: from?.id ?? null, toAccountId: c.id } });
  };

  return (
    <div>
      <PageTitle
        title="Money"
        right={
          <button onClick={() => setEditing({ kind: "bank" })} className={clsx(ghostBtn, "flex items-center gap-1.5")}>
            <Plus className="h-4 w-4" /> Account
          </button>
        }
      />
      <MoneyTabs />
      {loading ? (
        <SkeletonList rows={3} />
      ) : !accounts.length ? (
        <Empty
          icon={<Wallet className="h-6 w-6" />}
          title="Track your balances and cards"
          text="Add your bank accounts, cash, wallets and credit cards. Tag entries with an account and balances update by themselves. For cards, Remindo works out each bill and reminds you to pay it."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <button data-submit className={primaryBtn} onClick={() => setEditing({ kind: "bank" })}>
                Add bank account
              </button>
              <button className={ghostBtn} onClick={() => setEditing({ kind: "card" })}>
                💳 Add credit card
              </button>
            </div>
          }
        />
      ) : (
        <>
          <div className="card mb-5 grid grid-cols-2 gap-3 rounded-3xl p-5">
            <div>
              <p className="text-xs text-muted">You have</p>
              <p className={clsx("mt-1 text-2xl font-semibold tabular-nums", total < 0 && "text-rose-500")}>{formatINR(total)}</p>
              <p className="text-xs text-muted">in banks, cash &amp; wallets</p>
            </div>
            {cards.length > 0 && (
              <div>
                <p className="text-xs text-muted">Cards owe</p>
                <p className={clsx("mt-1 text-2xl font-semibold tabular-nums", owed > 0 && "text-rose-500")}>{formatINR(owed)}</p>
                <p className="text-xs text-muted">
                  {dueSoon.length ? `${formatINR(dueSoon.reduce((s, a) => s + a.card!.duePaise, 0))} bill due` : "No bill due"}
                </p>
              </div>
            )}
          </div>

          {cards.length > 0 && (
            <Section title="Credit cards">
              <div className="grid gap-3">
                {cards.map((c) => (
                  <CreditCard key={c.id} a={c} onEdit={() => setEditing(c)} onPay={() => payBill(c)} />
                ))}
              </div>
            </Section>
          )}

          <Section
            title="Bank, cash & wallets"
            right={
              !cards.length ? (
                <button onClick={() => setEditing({ kind: "card" })} className="text-indigo-500">
                  + Credit card
                </button>
              ) : undefined
            }
          >
            <div className="grid gap-2">
              {money.map((a) => (
                <button key={a.id} onClick={() => setEditing(a)} className="card flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left hover:bg-raised">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-raised text-lg">{ACCOUNT_META[a.kind].emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{a.name}</span>
                    <span className="block text-xs text-muted">{ACCOUNT_META[a.kind].label}</span>
                  </span>
                  <span className={clsx("font-semibold tabular-nums", a.balancePaise < 0 && "text-rose-500")}>{formatINR(a.balancePaise)}</span>
                  <Pencil className="h-4 w-4 text-subtle" />
                </button>
              ))}
              {!money.length && <p className="px-1 text-sm text-muted">Add the bank account you pay your card bills from.</p>}
            </div>
          </Section>
          {accounts.length >= 2 && (
            <button
              onClick={() => open({ mode: "expense", value: { type: "transfer", amount: 0, category: "Transfer", date: today, accountId: accounts[0].id, toAccountId: accounts[1].id } })}
              className={clsx(ghostBtn, "flex w-full items-center justify-center gap-2")}
            >
              <ArrowLeftRight className="h-4 w-4" /> Move money between accounts
            </button>
          )}
          <p className="mt-4 text-xs text-muted">
            Pick the card as the account when you spend with it. Paying the bill is a move from your bank to the card, so it never counts as spending twice. If a balance drifts from your bank app, edit the account and correct it.
          </p>
        </>
      )}
      {editing && <AccountForm initial={editing} banks={money} onClose={() => setEditing(null)} />}
    </div>
  );
}

const shortDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : n < 0 ? `${-n} day${n === -1 ? "" : "s"} late` : `in ${n} days`);

/** One credit card: what you owe, limit used, this month's bill and a Pay button. */
function CreditCard({ a, onEdit, onPay }: { a: Account; onEdit: () => void; onPay: () => void }) {
  const c = a.card;
  const owe = c?.outstandingPaise ?? -a.balancePaise;
  const used = c?.usedPct ?? null;
  return (
    <div className="card overflow-hidden rounded-3xl">
      <button onClick={onEdit} className="block w-full bg-gradient-to-br from-indigo-500/15 via-fuchsia-500/10 to-transparent px-4 pb-3 pt-4 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold">💳 {a.name}</p>
            <p className="text-xs text-muted">{owe > 0 ? "You owe" : owe < 0 ? "Extra paid" : "Nothing owed"}</p>
          </div>
          <div className="text-right">
            <p className={clsx("text-xl font-semibold tabular-nums", owe > 0 && "text-rose-500", owe < 0 && "text-emerald-600 dark:text-emerald-400")}>{formatINR(Math.abs(owe))}</p>
            <Pencil className="ml-auto mt-1 h-3.5 w-3.5 text-subtle" />
          </div>
        </div>
        {c?.limitPaise ? (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-raised">
              <div
                className={clsx("h-full rounded-full", used! >= 90 ? "bg-rose-500" : used! >= 30 ? "bg-amber-500" : "bg-emerald-500")}
                style={{ width: `${Math.min(100, used || 0)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted">
              {formatINR(Math.max(0, c.availablePaise || 0))} available of {formatINR(c.limitPaise)} · {used}% used
            </p>
          </div>
        ) : null}
      </button>
      <div className="flex items-center gap-3 border-t border-line px-4 py-3">
        <div className="min-w-0 flex-1 text-sm">
          {!c || c.status === "setup" ? (
            <button onClick={onEdit} className="text-left text-indigo-500">
              Add the bill day &amp; due day to track bills and get reminders
            </button>
          ) : c.status === "due" || c.status === "overdue" ? (
            <>
              <p className="font-medium">
                Bill <span className="tabular-nums">{formatINR(c.duePaise)}</span>
                {c.paidPaise > 0 && <span className="font-normal text-muted"> left of {formatINR(c.billPaise)}</span>}
              </p>
              <p className={clsx("text-xs", c.status === "overdue" ? "font-semibold text-rose-500" : c.daysToDue! <= 3 ? "text-amber-600" : "text-muted")}>
                Due {shortDay(c.dueDate!)} ({inDays(c.daysToDue!)})
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-emerald-600 dark:text-emerald-400">{c.status === "paid" ? `✓ ${shortDay(c.lastStatement!)} bill paid` : "No bill this month"}</p>
              <p className="text-xs text-muted">Next bill on {shortDay(c.nextStatement!)}</p>
            </>
          )}
          {c && c.status !== "setup" && c.unbilledPaise > 0 && <p className="text-xs text-muted">{formatINR(c.unbilledPaise)} spent since the last bill</p>}
        </div>
        {owe > 0 && (
          <button onClick={onPay} className={clsx(c?.status === "due" || c?.status === "overdue" ? primaryBtn : ghostBtn, "shrink-0 !px-3 !py-2")}>
            Pay bill
          </button>
        )}
      </div>
    </div>
  );
}

/** Amount box with a +/− switch: phone number pads have no minus key. */
export function SignedAmount({ value, onChange, negativeLabel, positiveLabel }: { value: string; onChange: (v: string) => void; negativeLabel: string; positiveLabel: string }) {
  const negative = value.trim().startsWith("-");
  const abs = value.replace(/^-/, "");
  return (
    <div className="flex gap-2">
      <div className="flex shrink-0 rounded-xl bg-raised p-1 text-xs font-medium">
        {[false, true].map((neg) => (
          <button
            key={String(neg)}
            type="button"
            onClick={() => onChange(neg ? (abs ? `-${abs}` : "-") : abs)}
            className={clsx("rounded-lg px-2.5 py-1.5", negative === neg ? (neg ? "bg-rose-500 text-white" : "bg-surface shadow-sm ring-1 ring-line") : "text-muted")}
          >
            {neg ? negativeLabel : positiveLabel}
          </button>
        ))}
      </div>
      <input
        className={field}
        type="text"
        inputMode="decimal"
        placeholder="0"
        value={abs}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.]/g, "");
          onChange(negative ? `-${v}` : v);
        }}
      />
    </div>
  );
}

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

function AccountForm({ initial, banks, onClose }: { initial: Partial<Account>; banks: Account[]; onClose: () => void }) {
  const { busy, run } = useSubmit();
  const [name, setName] = useState(initial.name || "");
  const [kind, setKind] = useState<AccountKind>(initial.kind || "bank");
  const [opening, setOpening] = useState(initial.openingBalancePaise != null ? String(initial.openingBalancePaise / 100) : "");
  // Cards: you type what you owe (a positive number); it's saved as a negative balance.
  const [owe, setOwe] = useState(initial.openingBalancePaise != null ? String(Math.max(0, -initial.openingBalancePaise) / 100 || "") : "");
  const [limit, setLimit] = useState(initial.creditLimitPaise ? String(initial.creditLimitPaise / 100) : "");
  const [statementDay, setStatementDay] = useState<number | "">(initial.statementDay || "");
  const [dueDay, setDueDay] = useState<number | "">(initial.dueDay || "");
  const [payFromId, setPayFromId] = useState(initial.payFromId || "");
  const card = kind === "card";
  const body = card
    ? {
        name,
        kind,
        openingBalance: -(Number(owe) || 0),
        creditLimit: Number(limit) || null,
        statementDay: statementDay || null,
        dueDay: dueDay || null,
        payFromId: payFromId || null,
      }
    : { name, kind, openingBalance: Number(opening) || 0 };
  const edit = Boolean(initial.id);
  return (
    <Modal title={edit ? (card ? "Edit credit card" : "Edit account") : card ? "New credit card" : "New account"} onClose={onClose}>
      <div className="grid gap-4">
        <div className="grid grid-cols-4 gap-1.5">
          {(Object.keys(ACCOUNT_META) as AccountKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={clsx("rounded-xl border py-2.5 text-xs font-medium", kind === k ? "border-indigo-400 bg-indigo-500/15" : "border-line text-muted")}
            >
              <span className="block text-lg">{ACCOUNT_META[k].emoji}</span>
              {ACCOUNT_META[k].label}
            </button>
          ))}
        </div>
        <div>
          <label className={label}>Name</label>
          <input className={field} autoFocus placeholder={card ? "e.g. HDFC Millennia" : "e.g. SBI savings, Cash"} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {card ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>{edit ? "You owed when you started (₹)" : "You owe today (₹)"}</label>
                <input className={field} type="text" inputMode="decimal" placeholder="0" value={owe} onChange={(e) => setOwe(e.target.value.replace(/[^\d.]/g, ""))} />
              </div>
              <div>
                <label className={label}>Credit limit (₹)</label>
                <input className={field} type="text" inputMode="decimal" placeholder="Optional" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^\d.]/g, ""))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Bill generated on</label>
                <select className={field} value={statementDay} onChange={(e) => setStatementDay(Number(e.target.value) || "")}>
                  <option value="">Day of month…</option>
                  {DAYS.map((d) => (
                    <option key={d} value={d}>
                      {ordinal(d)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>Pay by</label>
                <select className={field} value={dueDay} onChange={(e) => setDueDay(Number(e.target.value) || "")}>
                  <option value="">Day of month…</option>
                  {DAYS.map((d) => (
                    <option key={d} value={d}>
                      {ordinal(d)}
                      {statementDay && d <= statementDay ? " (next month)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {banks.length > 0 && (
              <div>
                <label className={label}>Pay the bill from</label>
                <select className={field} value={payFromId} onChange={(e) => setPayFromId(e.target.value)}>
                  <option value="">{banks.find((b) => b.kind === "bank")?.name || banks[0].name} (default)</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {ACCOUNT_META[b.kind].emoji} {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <p className="rounded-xl bg-indigo-500/10 px-3 py-2 text-xs text-indigo-800 dark:text-indigo-200">
              {statementDay && dueDay
                ? `Remindo works out each bill on the ${ordinal(statementDay)} and reminds you 3 days before, the day before and on the ${ordinal(dueDay)} with the amount due. Paying the bill ticks it off.`
                : "Add the bill day and the pay-by day (they're on your card statement) to get the bill amount and a reminder every month."}
            </p>
          </>
        ) : (
          <div>
            <label className={label}>{edit ? "Starting balance" : "Balance today"} (₹)</label>
            <SignedAmount value={opening} onChange={setOpening} positiveLabel="In credit" negativeLabel="Overdrawn" />
          </div>
        )}
        <div className="flex gap-2">
          {initial.id && (
            <button
              className={clsx(ghostBtn, "text-rose-500")}
              onClick={() => run(() => api(`/api/accounts/${initial.id}`, { method: "DELETE" }), card ? "Card removed" : "Account removed", onClose)}
            >
              Remove
            </button>
          )}
          <button
            data-submit
            className={clsx(primaryBtn, "flex-1")}
            disabled={busy || !name.trim() || (card && Boolean(statementDay) !== Boolean(dueDay))}
            onClick={() =>
              run(
                () => (initial.id ? api(`/api/accounts/${initial.id}`, { method: "PATCH", json: body }) : api("/api/accounts", { method: "POST", json: body })),
                initial.id ? (card ? "Card updated" : "Account updated") : card ? "Card added 💳" : "Account added",
                onClose,
              )
            }
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------- Goals

const GOAL_EMOJIS = ["🎯", "✈️", "💻", "🏍️", "🏠", "💍", "🎓", "📱", "🏖️", "🚗", "🛡️", "🎁"];

export function GoalsScreen() {
  const { data, loading } = useData<{ goals: Goal[] }>("/api/goals");
  const [editing, setEditing] = useState<Partial<Goal> | null>(null);
  const [adding, setAdding] = useState<Goal | null>(null);
  const goals = data?.goals || [];
  return (
    <div>
      <PageTitle
        title="Money"
        right={
          <button onClick={() => setEditing({})} className={clsx(ghostBtn, "flex items-center gap-1.5")}>
            <Plus className="h-4 w-4" /> Goal
          </button>
        }
      />
      <MoneyTabs />
      {loading ? (
        <SkeletonList rows={2} />
      ) : !goals.length ? (
        <Empty
          icon={<PiggyBank className="h-6 w-6" />}
          title="Save for something"
          text="“₹50,000 for a trip by March.” Remindo shows your progress and how much to put aside each month."
          action={
            <button data-submit className={primaryBtn} onClick={() => setEditing({})}>
              Create a goal
            </button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {goals.map((g) => {
            const pct = Math.min(100, Math.round((g.savedPaise / g.targetPaise) * 100));
            const done = g.savedPaise >= g.targetPaise;
            return (
              <div key={g.id} className="card rounded-3xl p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-raised text-2xl">{g.emoji || "🎯"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{g.name}</p>
                    <p className="text-xs text-muted">
                      {formatINR(g.savedPaise)} of {formatINR(g.targetPaise)}
                      {g.deadline ? ` · by ${relativeDay(g.deadline)}` : ""}
                    </p>
                  </div>
                  <button onClick={() => setEditing(g)} aria-label="Edit goal" className="grid h-8 w-8 place-items-center rounded-lg text-subtle hover:bg-raised">
                    <Pencil className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-4 h-3 overflow-hidden rounded-full bg-raised">
                  <div className={clsx("h-full rounded-full transition-all", done ? "bg-emerald-500" : "bg-indigo-500")} style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted">
                  <span>{done ? "🎉 Goal reached!" : `${pct}%`}</span>
                  {!done && g.perMonthPaise ? (
                    <span>
                      Save <b className="text-fg">{formatINR(g.perMonthPaise)}</b>/month
                      {g.savedThisMonthPaise ? ` · ${formatINR(g.savedThisMonthPaise)} this month` : ""}
                    </span>
                  ) : null}
                </div>
                {!done && (
                  <button onClick={() => setAdding(g)} className={clsx(ghostBtn, "mt-4 flex w-full items-center justify-center gap-1.5")}>
                    <Plus className="h-4 w-4" /> Add money
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {editing && <GoalForm initial={editing} onClose={() => setEditing(null)} />}
      {adding && <ContributionForm goal={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

function GoalForm({ initial, onClose }: { initial: Partial<Goal>; onClose: () => void }) {
  const { busy, run } = useSubmit();
  const [name, setName] = useState(initial.name || "");
  const [emoji, setEmoji] = useState(initial.emoji || "🎯");
  const [target, setTarget] = useState(initial.targetPaise ? String(initial.targetPaise / 100) : "");
  const [deadline, setDeadline] = useState(initial.deadline || "");
  const body = { name, emoji, target: Number(target), deadline: deadline || null };
  return (
    <Modal title={initial.id ? "Edit goal" : "New savings goal"} onClose={onClose}>
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-1.5">
          {GOAL_EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => setEmoji(e)} className={clsx("grid h-10 w-10 place-items-center rounded-xl text-xl", emoji === e ? "bg-indigo-500/20 ring-1 ring-indigo-400" : "bg-raised")}>
              {e}
            </button>
          ))}
        </div>
        <div>
          <label className={label}>What for?</label>
          <input className={field} autoFocus placeholder="e.g. Goa trip, New laptop, Emergency fund" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Target (₹)</label>
            <input className={field} type="number" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
          <div>
            <label className={label}>By (optional)</label>
            <input className={field} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2">
          {initial.id && (
            <button className={clsx(ghostBtn, "text-rose-500")} onClick={() => run(() => api(`/api/goals/${initial.id}`, { method: "DELETE" }), "Goal removed", onClose)}>
              Remove
            </button>
          )}
          <button data-submit
            className={clsx(primaryBtn, "flex-1")}
            disabled={busy || !name.trim() || !(Number(target) > 0)}
            onClick={() =>
              run(
                () => (initial.id ? api(`/api/goals/${initial.id}`, { method: "PATCH", json: body }) : api("/api/goals", { method: "POST", json: body })),
                initial.id ? "Goal updated" : "Goal created 🎯",
                onClose,
              )
            }
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ContributionForm({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const { busy, run } = useSubmit();
  const [amount, setAmount] = useState(goal.perMonthPaise ? String(Math.ceil(goal.perMonthPaise / 100)) : "");
  const [withdraw, setWithdraw] = useState(false);
  return (
    <Modal title={`${goal.emoji || "🎯"} ${goal.name}`} onClose={onClose}>
      <div className="grid gap-4">
        <div className="flex rounded-xl bg-raised p-1">
          {[false, true].map((w) => (
            <button key={String(w)} onClick={() => setWithdraw(w)} className={clsx("flex-1 rounded-lg py-2 text-sm font-medium", withdraw === w ? "bg-surface shadow-sm ring-1 ring-line" : "text-muted")}>
              {w ? "Take out" : "Add money"}
            </button>
          ))}
        </div>
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-3xl font-semibold text-muted">₹</span>
          <input type="number" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} className="w-48 bg-transparent text-center text-5xl font-semibold outline-none" />
        </div>
        <button data-submit
          className={primaryBtn}
          disabled={busy || !(Number(amount) > 0)}
          onClick={() =>
            run(() => api(`/api/goals/${goal.id}`, { method: "POST", json: { amount: withdraw ? -Number(amount) : Number(amount) } }), withdraw ? "Taken out" : "Added to goal 💪", onClose)
          }
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {withdraw ? "Take out" : "Add"}
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------- Dues

export function DuesScreen() {
  const hidden = useHidden();
  const { undoable } = useToast();
  const { data, loading } = useData<{ open: Due[]; settled: Due[]; theyOwe: number; iOwe: number }>("/api/dues");
  const [adding, setAdding] = useState(false);
  const { busy, run } = useSubmit();
  const open = (data?.open || []).filter((d) => !hidden.has(d.id));

  const remove = (d: Due) => {
    hideId(d.id);
    undoable("Removed", () => api(`/api/dues/${d.id}`, { method: "DELETE" }).then(refreshAll), () => unhideId(d.id));
  };

  return (
    <div>
      <PageTitle
        title="Money"
        right={
          <button onClick={() => setAdding(true)} className={clsx(ghostBtn, "flex items-center gap-1.5")}>
            <Plus className="h-4 w-4" /> Due
          </button>
        }
      />
      <MoneyTabs />
      {loading ? (
        <SkeletonList rows={2} />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3">
            <div className="card rounded-3xl p-4">
              <p className="text-xs text-muted">Others owe you</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-500">{formatINR(data?.theyOwe || 0)}</p>
            </div>
            <div className="card rounded-3xl p-4">
              <p className="text-xs text-muted">You owe</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-rose-500">{formatINR(data?.iOwe || 0)}</p>
            </div>
          </div>
          {!open.length ? (
            <Empty
              icon={<Handshake className="h-6 w-6" />}
              title="All square"
              text="Say “Paid 1200 for dinner, Arun owes 600” or tap + Due. Remindo reminds you to collect and logs it when settled."
            />
          ) : (
            <Section title="Open">
              {open.map((d) => (
                <div key={d.id} className="card flex items-center gap-3 rounded-2xl px-4 py-3">
                  <span className={clsx("grid h-10 w-10 place-items-center rounded-xl text-sm font-semibold", d.direction === "they_owe" ? "bg-emerald-500/15 text-emerald-600" : "bg-rose-500/15 text-rose-600")}>
                    {d.person.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{d.direction === "they_owe" ? `${d.person} owes you` : `You owe ${d.person}`}</span>
                    <span className="block truncate text-xs text-muted">
                      {d.note ? `${d.note} · ` : ""}since {relativeDay(d.createdAt.slice(0, 10))}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatINR(d.amountPaise)}</span>
                  <button
                    disabled={busy}
                    onClick={() => run(() => api(`/api/dues/${d.id}`, { method: "POST", json: { log: true } }), d.direction === "they_owe" ? "Settled · logged as received" : "Settled · logged as paid")}
                    className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
                  >
                    <Check className="h-3.5 w-3.5" /> Settled
                  </button>
                  <ShareButton
                    text={dueShareText(d)}
                    title={d.direction === "they_owe" ? `Remind ${d.person}` : `Message ${d.person}`}
                    label=""
                    className="grid h-8 w-8 place-items-center rounded-lg text-subtle hover:text-indigo-500"
                  />
                  <button onClick={() => remove(d)} aria-label="Remove" className="grid h-8 w-8 place-items-center rounded-lg text-subtle hover:text-rose-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </Section>
          )}
          {(data?.settled || []).length > 0 && (
            <Section title="Recently settled">
              {data!.settled.slice(0, 8).map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-xl px-4 py-2 text-sm text-muted">
                  <span className="line-through">{d.direction === "they_owe" ? `${d.person} owed you` : `You owed ${d.person}`}</span>
                  <span>{formatINR(d.amountPaise)}</span>
                </div>
              ))}
            </Section>
          )}
        </>
      )}
      {adding && <DueForm onClose={() => setAdding(false)} />}
    </div>
  );
}

export function DueForm({ onClose }: { onClose: () => void }) {
  const { busy, run } = useSubmit();
  const [person, setPerson] = useState("");
  const [direction, setDirection] = useState<"they_owe" | "i_owe">("they_owe");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [remindOn, setRemindOn] = useState("");
  return (
    <Modal title="New due" onClose={onClose}>
      <div className="grid gap-4">
        <div className="flex rounded-xl bg-raised p-1">
          {(
            [
              ["they_owe", "They owe me"],
              ["i_owe", "I owe them"],
            ] as const
          ).map(([d, l]) => (
            <button key={d} onClick={() => setDirection(d)} className={clsx("flex-1 rounded-lg py-2 text-sm font-medium", direction === d ? "bg-surface shadow-sm ring-1 ring-line" : "text-muted")}>
              {l}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Person</label>
            <input className={field} autoFocus value={person} onChange={(e) => setPerson(e.target.value)} />
          </div>
          <div>
            <label className={label}>Amount (₹)</label>
            <input className={field} type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        </div>
        <div>
          <label className={label}>For (optional)</label>
          <input className={field} placeholder="e.g. Dinner at Paragon" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div>
          <label className={label}>Remind me on (default: in 3 days)</label>
          <input className={field} type="date" value={remindOn} onChange={(e) => setRemindOn(e.target.value)} />
        </div>
        <button data-submit
          className={primaryBtn}
          disabled={busy || !person.trim() || !(Number(amount) > 0)}
          onClick={() =>
            run(
              () => api("/api/dues", { method: "POST", json: { items: [{ person, direction, amount: Number(amount), note: note || null, remindOn: remindOn || undefined }] } }),
              "Due added",
              onClose,
            )
          }
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
        </button>
      </div>
    </Modal>
  );
}

