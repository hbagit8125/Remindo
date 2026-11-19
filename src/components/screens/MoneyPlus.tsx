"use client";

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
      <div onClick={(e) => e.stopPropagation()} className="animate-sheet pb-safe max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-line bg-[var(--bg)] p-5 md:max-w-md md:rounded-3xl">
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
  const total = accounts.filter((a) => a.kind !== "card").reduce((s, a) => s + a.balancePaise, 0);
  const cardDue = accounts.filter((a) => a.kind === "card").reduce((s, a) => s + a.balancePaise, 0);

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
          title="Track your balances"
          text="Add your bank accounts, cards, cash and wallets with today's balance. Tag entries with an account and balances update automatically."
          action={
            <button className={primaryBtn} onClick={() => setEditing({ kind: "bank" })}>
              Add first account
            </button>
          }
        />
      ) : (
        <>
          <div className="card mb-5 grid grid-cols-2 gap-3 rounded-3xl p-5">
            <div>
              <p className="text-xs text-muted">Total balance</p>
              <p className={clsx("mt-1 text-2xl font-semibold tabular-nums", total < 0 && "text-rose-500")}>{formatINR(total)}</p>
            </div>
            {cardDue !== 0 && (
              <div>
                <p className="text-xs text-muted">Card balance</p>
                <p className={clsx("mt-1 text-2xl font-semibold tabular-nums", cardDue < 0 && "text-rose-500")}>{formatINR(cardDue)}</p>
              </div>
            )}
          </div>
          <Section title="Accounts">
            {accounts.map((a) => (
              <div key={a.id} className="card flex items-center gap-3 rounded-2xl px-4 py-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-raised text-lg">{ACCOUNT_META[a.kind].emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.name}</span>
                  <span className="block text-xs text-muted">{ACCOUNT_META[a.kind].label}</span>
                </span>
                <span className={clsx("font-semibold tabular-nums", a.balancePaise < 0 && "text-rose-500")}>{formatINR(a.balancePaise)}</span>
                <button onClick={() => setEditing(a)} aria-label="Edit account" className="grid h-9 w-9 place-items-center rounded-lg text-subtle hover:bg-raised">
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            ))}
          </Section>
          {accounts.length >= 2 && (
            <button
              onClick={() => open({ mode: "expense", value: { type: "transfer", amount: 0, category: "Transfer", date: new Date().toLocaleDateString("en-CA"), accountId: accounts[0].id, toAccountId: accounts[1].id } })}
              className={clsx(ghostBtn, "flex w-full items-center justify-center gap-2")}
            >
              <ArrowLeftRight className="h-4 w-4" /> Move money between accounts
            </button>
          )}
          <p className="mt-4 text-xs text-muted">
            A balance here only counts entries tagged with that account. If it drifts from your bank app, edit the account and correct the starting balance.
          </p>
        </>
      )}
      {editing && <AccountForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AccountForm({ initial, onClose }: { initial: Partial<Account>; onClose: () => void }) {
  const { busy, run } = useSubmit();
  const [name, setName] = useState(initial.name || "");
  const [kind, setKind] = useState<AccountKind>(initial.kind || "bank");
  const [opening, setOpening] = useState(initial.openingBalancePaise != null ? String(initial.openingBalancePaise / 100) : "");
  const body = { name, kind, openingBalance: Number(opening) || 0 };
  return (
    <Modal title={initial.id ? "Edit account" : "New account"} onClose={onClose}>
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
          <input className={field} autoFocus placeholder="e.g. SBI savings, HDFC card, Cash" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={label}>{initial.id ? "Starting balance" : "Balance today"} (₹){kind === "card" ? ": use a negative number for money owed" : ""}</label>
          <input className={field} type="number" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
        </div>
        <div className="flex gap-2">
          {initial.id && (
            <button
              className={clsx(ghostBtn, "text-rose-500")}
              onClick={() => run(() => api(`/api/accounts/${initial.id}`, { method: "DELETE" }), "Account removed", onClose)}
            >
              Remove
            </button>
          )}
          <button
            className={clsx(primaryBtn, "flex-1")}
            disabled={busy || !name.trim()}
            onClick={() =>
              run(
                () => (initial.id ? api(`/api/accounts/${initial.id}`, { method: "PATCH", json: body }) : api("/api/accounts", { method: "POST", json: body })),
                initial.id ? "Account updated" : "Account added",
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
            <button className={primaryBtn} onClick={() => setEditing({})}>
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
          <button
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
        <button
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

function DueForm({ onClose }: { onClose: () => void }) {
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
        <button
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

