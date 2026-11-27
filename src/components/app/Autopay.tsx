"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { AlertTriangle, Check, Loader2, Plus } from "lucide-react";
import { api, useData, useHidden } from "./client";
import { field, label } from "./ReminderEditor";
import { useUndoDelete } from "./rows";
import { Modal, ghostBtn, primaryBtn, useSubmit } from "@/components/screens/MoneyPlus";
import { ACCOUNT_META, type Account } from "@/components/types";
import { formatINR } from "@/lib/money";

export type AutopayRow = {
  id: string;
  kind: "sip" | "emi";
  name: string;
  amountPaise: number;
  frequency: Frequency;
  day: number;
  month: number | null;
  accountId: string | null;
  savingId: string | null;
  totalCount: number | null;
  paidBefore: number;
  loanPaise: number | null;
  lender: string | null;
  active: boolean;
  paidCount: number;
  remainingCount: number | null;
  remainingPaise: number | null;
  endDate: string | null;
  nextDate: string | null;
  lastPaid: string | null;
  accountName: string | null;
  savingName: string | null;
  short: number;
};

type Frequency = "daily" | "weekly" | "monthly" | "yearly";
const FREQS: { f: Frequency; label: string }[] = [
  { f: "daily", label: "Daily" },
  { f: "weekly", label: "Weekly" },
  { f: "monthly", label: "Monthly" },
  { f: "yearly", label: "Yearly" },
];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Every day", "Every Monday", "5th every month", "Every 15 Mar". */
function when(a: { frequency?: Frequency; day: number; month?: number | null }) {
  if (a.frequency === "daily") return "Every day";
  if (a.frequency === "weekly") return `Every ${WEEKDAYS[a.day - 1] || "week"}`;
  if (a.frequency === "yearly") return `Every ${a.day} ${MONTHS[(a.month || 1) - 1]}`;
  return `${ordinal(a.day)} every month`;
}
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const short = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const monthYear = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
const lakh = (p: number) => (p >= 1e7 ? `₹${(p / 1e7).toFixed(p % 1e7 ? 1 : 0)}L` : formatINR(p));

/** SIPs or EMIs, with "+ SIP / + EMI". */
export function AutopayList({ kind, savingId }: { kind: "sip" | "emi"; savingId?: string }) {
  const { data } = useData<{ autopays: AutopayRow[] }>("/api/autopays");
  const hidden = useHidden();
  const [editing, setEditing] = useState<Partial<AutopayRow> | null>(null);
  const [paying, setPaying] = useState<AutopayRow | null>(null);
  const list = (data?.autopays || []).filter((a) => a.kind === kind && !hidden.has(a.id) && (!savingId || a.savingId === savingId));
  const title = kind === "sip" ? "SIPs & auto-deposits" : "Loans & EMIs";
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle">{title}</h3>
        <button onClick={() => setEditing({ kind, savingId: savingId ?? null, active: true })} className="flex items-center gap-1 text-xs font-medium text-indigo-500">
          <Plus className="h-3.5 w-3.5" /> {kind === "sip" ? "Auto-deposit" : "EMI"}
        </button>
      </div>
      {!list.length ? (
        <button
          onClick={() => setEditing({ kind, savingId: savingId ?? null, active: true })}
          className="card w-full rounded-2xl px-4 py-3 text-left text-sm text-muted hover:bg-raised"
        >
          {kind === "sip"
            ? "Add a SIP or auto-deposit (RD, PPF, gold…): daily, weekly, monthly or yearly, moved from your bank into the saving by itself."
            : "Add an EMI: it's paid from your account on the due date, and stops after the last one."}
        </button>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {list.map((a) => (
            <AutopayCard key={a.id} a={a} onOpen={() => setEditing(a)} onPayEarly={() => setPaying(a)} />
          ))}
        </div>
      )}
      {editing && <AutopayForm initial={editing} onClose={() => setEditing(null)} onPayEarly={(a) => (setEditing(null), setPaying(a))} />}
      {paying && <PayEarly a={paying} onClose={() => setPaying(null)} />}
    </section>
  );
}

function AutopayCard({ a, onOpen, onPayEarly }: { a: AutopayRow; onOpen: () => void; onPayEarly: () => void }) {
  const done = a.kind === "emi" && a.remainingCount === 0;
  const pct = a.kind === "emi" && a.totalCount ? Math.round((a.paidCount / a.totalCount) * 100) : null;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className={clsx("card w-full cursor-pointer rounded-2xl px-3.5 py-3 text-left hover:bg-raised", !a.active && !done && "opacity-60")}
    >
      <div className="flex items-center gap-3">
        <span className={clsx("grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg", a.kind === "sip" ? "bg-emerald-500/15" : "bg-sky-500/15")}>{a.kind === "sip" ? "🔁" : "🏠"}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{a.name}</span>
          <span className="block truncate text-xs text-muted">
            {when(a)}{a.accountName ? ` · from ${a.accountName}` : ""}
            {a.kind === "sip" && a.savingName ? ` → ${a.savingName}` : ""}
            {a.kind === "emi" && a.lender ? ` · ${a.lender}` : ""}
          </span>
        </span>
        <span className="text-right">
          <span className="block font-semibold tabular-nums">{formatINR(a.amountPaise)}</span>
          <span className="block text-xs text-muted">{done ? "Paid off 🎉" : !a.active ? "Paused" : a.nextDate ? `next ${short(a.nextDate)}` : ""}</span>
        </span>
      </div>
      {pct !== null && (
        <div className="mt-2.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted">
            EMI {Math.min(a.paidCount, a.totalCount!)} of {a.totalCount} paid
            {a.remainingPaise ? ` · ${lakh(a.remainingPaise)} left` : ""}
            {a.endDate && !done ? ` · ends ${monthYear(a.endDate)}` : ""}
          </p>
        </div>
      )}
      {a.short > 0 && a.active && (
        <p className="mt-2 flex items-center gap-1 text-xs font-medium text-amber-600">
          <AlertTriangle className="h-3.5 w-3.5" /> {a.accountName} is {formatINR(a.short)} short for the next one
        </p>
      )}
      {a.active && a.nextDate && (
        <div className="mt-2 flex justify-end">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPayEarly();
            }}
            className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-medium hover:bg-raised"
          >
            <Check className="h-3.5 w-3.5" /> Paid early
          </button>
        </div>
      )}
    </div>
  );
}

export function AutopayForm({ initial, onClose, onPayEarly }: { initial: Partial<AutopayRow>; onClose: () => void; onPayEarly?: (a: AutopayRow) => void }) {
  const { busy, run } = useSubmit();
  const del = useUndoDelete();
  const kind = initial.kind || "sip";
  const sip = kind === "sip";
  const accounts = (useData<{ accounts: Account[] }>("/api/accounts").data?.accounts || []).filter((a) => !sip || a.kind !== "card");
  const savingsList = useData<{ savings: { id: string; name: string }[] }>(sip ? "/api/savings" : null).data?.savings || [];
  const [name, setName] = useState(initial.name || "");
  const [amount, setAmount] = useState(initial.amountPaise ? String(initial.amountPaise / 100) : "");
  const now = new Date();
  const [frequency, setFrequency] = useState<Frequency>(initial.frequency || "monthly");
  const [day, setDay] = useState<number>(initial.day || now.getDate());
  const [weekday, setWeekday] = useState<number>(initial.frequency === "weekly" ? initial.day! : ((now.getDay() + 6) % 7) + 1);
  const [month, setMonth] = useState<number>(initial.month || now.getMonth() + 1);
  const [accountId, setAccountId] = useState(initial.accountId || "");
  const [savingId, setSavingId] = useState(initial.savingId || "");
  const [lender, setLender] = useState(initial.lender || "");
  const [total, setTotal] = useState(initial.totalCount ? String(initial.totalCount) : "");
  const [paidBefore, setPaidBefore] = useState(initial.paidBefore ? String(initial.paidBefore) : "");
  const [loan, setLoan] = useState(initial.loanPaise ? String(initial.loanPaise / 100) : "");
  const [active, setActive] = useState(initial.active ?? true);
  const edit = Boolean(initial.id);
  const acc = accounts.find((a) => a.id === (accountId || accounts[0]?.id));
  const num = (v: string) => v.replace(/[^\d.]/g, "");
  const body = {
    kind,
    name,
    amount: Number(amount) || 0,
    frequency: sip ? frequency : "monthly",
    day: sip && frequency === "weekly" ? weekday : day,
    month: sip && frequency === "yearly" ? month : null,
    accountId: accountId || accounts[0]?.id || null,
    savingId: savingId || null,
    newSavingName: savingId ? null : name,
    totalCount: Number(total) || null,
    paidBefore: Number(paidBefore) || 0,
    loanAmount: Number(loan) || null,
    lender: lender || null,
    active,
  };
  return (
    <Modal title={edit ? `Edit ${sip ? "auto-deposit" : "EMI"}` : sip ? "New SIP / auto-deposit" : "New EMI"} onClose={onClose}>
      <div className="grid gap-4">
        <div className="grid grid-cols-[1fr_8rem] gap-3">
          <div>
            <label className={label}>Name</label>
            <input className={field} autoFocus placeholder={sip ? "e.g. Nifty 50 SIP" : "e.g. Bike loan"} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={label}>Amount (₹)</label>
            <input className={field} type="text" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(num(e.target.value))} />
          </div>
        </div>
        {sip && (
          <div className="flex rounded-xl bg-raised p-1 text-sm font-medium">
            {FREQS.map(({ f, label: l }) => (
              <button
                key={f}
                type="button"
                onClick={() => setFrequency(f)}
                className={clsx("flex-1 rounded-lg py-2", frequency === f ? "bg-surface shadow-sm ring-1 ring-line" : "text-muted")}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {sip && frequency === "daily" ? (
            <div>
              <label className={label}>When</label>
              <div className={clsx(field, "flex items-center text-muted")}>Every day</div>
            </div>
          ) : sip && frequency === "weekly" ? (
            <div>
              <label className={label}>Every</label>
              <select className={field} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((w, i) => (
                  <option key={w} value={i + 1}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
          ) : sip && frequency === "yearly" ? (
            <div>
              <label className={label}>Every year on</label>
              <div className="grid grid-cols-[1fr_1.2fr] gap-1.5">
                <select className={field} value={day} onChange={(e) => setDay(Number(e.target.value))}>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <select className={field} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div>
              <label className={label}>Every month on</label>
              <select className={field} value={day} onChange={(e) => setDay(Number(e.target.value))}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {ordinal(d)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className={label}>{sip ? "From" : "Paid from"}</label>
            <select className={field} value={accountId || accounts[0]?.id || ""} onChange={(e) => setAccountId(e.target.value)}>
              {!accounts.length && <option value="">Add an account first</option>}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {ACCOUNT_META[a.kind].emoji} {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {sip ? (
          <div>
            <label className={label}>Into</label>
            <select className={field} value={savingId} onChange={(e) => setSavingId(e.target.value)}>
              <option value="">New saving “{name || "…"}”</option>
              {savingsList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Lender</label>
                <input className={field} placeholder="e.g. HDFC Bank" value={lender} onChange={(e) => setLender(e.target.value)} />
              </div>
              <div>
                <label className={label}>Loan amount (₹)</label>
                <input className={field} type="text" inputMode="decimal" placeholder="Optional" value={loan} onChange={(e) => setLoan(num(e.target.value))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Total EMIs</label>
                <input className={field} type="text" inputMode="numeric" placeholder="e.g. 24" value={total} onChange={(e) => setTotal(e.target.value.replace(/\D/g, ""))} />
              </div>
              <div>
                <label className={label}>Already paid</label>
                <input className={field} type="text" inputMode="numeric" placeholder="0" value={paidBefore} onChange={(e) => setPaidBefore(e.target.value.replace(/\D/g, ""))} />
              </div>
            </div>
          </>
        )}
        {edit && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!active} onChange={(e) => setActive(!e.target.checked)} className="h-4 w-4 accent-indigo-500" />
            Paused (nothing is recorded while paused)
          </label>
        )}
        <p className="rounded-xl bg-indigo-500/10 px-3 py-2 text-xs text-indigo-800 dark:text-indigo-200">
          {sip ? when({ frequency, day: frequency === "weekly" ? weekday : day, month }) : `On the ${ordinal(day)}`}, {formatINR(Math.round((Number(amount) || 0) * 100))} is recorded from {acc?.name || "the account"} by itself
          {sip ? " and added to the saving (a transfer, not spending)" : " as an EMI/Loans expense"}. If {acc?.name || "it"} looks short the day before, you get a reminder at 7 pm.
          {!sip && Number(total) ? ` It stops after EMI ${total}.` : ""} Telegram shows each payment with an Undo button.
        </p>
        {edit && initial.active && initial.nextDate && onPayEarly && (
          <button onClick={() => onPayEarly(initial as AutopayRow)} className={clsx(ghostBtn, "flex items-center justify-center gap-1.5")}>
            <Check className="h-4 w-4" /> Paid early: mark the {short(initial.nextDate)} payment as done
          </button>
        )}
        <div className="flex gap-2">
          {edit && (
            <button
              className={clsx(ghostBtn, "text-rose-500")}
              onClick={() => {
                del(initial.id!, `${name} deleted`, `/api/autopays/${initial.id}`);
                onClose();
              }}
            >
              Delete
            </button>
          )}
          <button
            data-submit
            className={clsx(primaryBtn, "flex-1")}
            disabled={busy || !name.trim() || !Number(amount) || !accounts.length}
            onClick={() =>
              run(
                () => (edit ? api(`/api/autopays/${initial.id}`, { method: "PATCH", json: body }) : api("/api/autopays", { method: "POST", json: body })),
                edit ? "Updated" : sip ? "Auto-deposit set up 🔁" : "EMI added",
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

/** "Paid early": records the next payment now (or on the day you paid); the automatic one skips it. */
function PayEarly({ a, onClose }: { a: AutopayRow; onClose: () => void }) {
  const { busy, run } = useSubmit();
  const today = new Date().toLocaleDateString("en-CA");
  const [paidOn, setPaidOn] = useState(today);
  // Paid from: the usual account by default; any other account or card, or "Other" (not tracked).
  const accounts = (useData<{ accounts: Account[] }>("/api/accounts").data?.accounts || []).filter((x) => a.kind === "emi" || x.kind !== "card");
  const [from, setFrom] = useState<string>(a.accountId || "other");
  const fromAcc = accounts.find((x) => x.id === from);
  const emiNo = a.kind === "emi" ? Math.min(a.paidCount + 1, a.totalCount ?? a.paidCount + 1) : null;
  return (
    <Modal title={`Paid early · ${a.name}`} onClose={onClose}>
      <div className="grid gap-4">
        <div className="card rounded-2xl p-4">
          <p className="text-xs text-muted">{a.kind === "emi" ? `EMI ${emiNo}${a.totalCount ? ` of ${a.totalCount}` : ""}` : "Next payment"}, due {a.nextDate ? short(a.nextDate) : ""}</p>
          <p className="text-2xl font-semibold tabular-nums">{formatINR(a.amountPaise)}</p>
        </div>
        <div className="grid grid-cols-[1.4fr_1fr] gap-3">
          <div>
            <label className={label}>Paid from</label>
            <select className={field} value={from} onChange={(e) => setFrom(e.target.value)}>
              {accounts.map((x) => (
                <option key={x.id} value={x.id}>
                  {ACCOUNT_META[x.kind].emoji} {x.name}
                  {x.id === a.accountId ? " ✓" : ""}
                </option>
              ))}
              <option value="other">Other (not in Remindo)</option>
            </select>
          </div>
          <div>
            <label className={label}>Paid on</label>
            <input className={field} type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
        </div>
        {fromAcc && fromAcc.kind !== "card" && fromAcc.balancePaise < a.amountPaise && (
          <p className="-mt-2 text-xs text-amber-600">
            {fromAcc.name} shows {formatINR(fromAcc.balancePaise)}: this takes it below zero.
          </p>
        )}
        {from === "other" && <p className="-mt-2 text-xs text-muted">Recorded without changing any balance (e.g. paid by someone else or from an account you don&apos;t track).</p>}
        <p className="text-xs text-muted">
          It&apos;s recorded now{a.kind === "sip" ? " and added to the saving" : " as an EMI/Loans expense"}. On {a.nextDate ? short(a.nextDate) : "the due date"} nothing more is taken and there&apos;s no low-balance reminder for it. The next one after that stays as usual.
        </p>
        <button
          data-submit
          className={primaryBtn}
          disabled={busy}
          onClick={() => run(() => api(`/api/autopays/${a.id}/pay`, { method: "POST", json: { paidOn, accountId: from === "other" ? null : from } }), a.kind === "emi" ? `EMI ${emiNo} marked paid ✓` : "Marked paid ✓", onClose)}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Mark as paid
        </button>
      </div>
    </Modal>
  );
}
