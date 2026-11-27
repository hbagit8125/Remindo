"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { ArrowDownLeft, ArrowUpRight, Loader2, Pencil, PiggyBank, Plus, RefreshCw, Sparkles, Trash2, TrendingDown, TrendingUp, Unlink } from "lucide-react";
import { useToast } from "@/components/app/toast";
import { api, refreshAll, useData, useHidden } from "@/components/app/client";
import { Empty, PageTitle, Section, SkeletonList, useUndoDelete } from "@/components/app/rows";
import { MoneyTabs } from "@/components/app/MoneyTabs";
import { field, label } from "@/components/app/ReminderEditor";
import { Modal, ghostBtn, primaryBtn, useSubmit } from "@/components/screens/MoneyPlus";
import { ACCOUNT_META, type Account } from "@/components/types";
import { formatINR } from "@/lib/money";
import { MARKET_KINDS, SAVING_KINDS, type SavingKind } from "@/lib/savings-kinds";
import { AutopayList } from "@/components/app/Autopay";
import { HideAmountsButton } from "@/components/app/HideAmounts";

type Totals = { inPaise: number; outPaise: number; growthPaise: number; valuePaise: number; investedPaise: number; returnPct: number | null };
type Saving = Totals & {
  id: string;
  name: string;
  kind: SavingKind;
  institution: string | null;
  ratePct: string | null;
  maturityDate: string | null;
  interestFreq?: InterestFreq | null;
  interestAccountId?: string | null;
  interestFrom?: string | null;
  nextInterest?: { date: string; paise: number } | null;
  notes: string | null;
  lastDate?: string | null;
};
type InterestFreq = "monthly" | "quarterly" | "halfyearly" | "yearly";
const INTEREST_LABEL: Record<InterestFreq, string> = { monthly: "monthly", quarterly: "quarterly", halfyearly: "half-yearly", yearly: "yearly" };
type Entry = { id: string; type: "deposit" | "withdraw" | "growth"; amountPaise: number; date: string; note: string | null; transactionId: string | null };
type EntryKind = "deposit" | "withdraw" | "growth" | "value";

const todayStr = () => new Date().toLocaleDateString("en-CA");
const shortDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: d.slice(0, 4) === todayStr().slice(0, 4) ? undefined : "numeric" });
const daysTo = (d: string) => Math.round((Date.parse(`${d}T00:00:00`) - Date.parse(`${todayStr()}T00:00:00`)) / 864e5);
const meta = (k: string) => SAVING_KINDS[k as SavingKind] || SAVING_KINDS.other;
const ordinalDay = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const signed = (p: number) => `${p >= 0 ? "+" : "−"}${formatINR(Math.abs(p))}`;
const pct = (n: number | null) => (n === null ? "" : ` (${n >= 0 ? "+" : ""}${n}%)`);

// ------------------------------------------------------------- tab

export function SavingsScreen() {
  const { data, loading } = useData<{ savings: Saving[]; total: Totals & { earnedThisYear: number } }>("/api/savings");
  const hidden = useHidden();
  const [editing, setEditing] = useState<Partial<Saving> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = (data?.savings || []).filter((s) => !hidden.has(s.id));
  const t = data?.total;

  return (
    <div>
      <PageTitle
        title="Money"
        right={
          <button onClick={() => setEditing({ kind: "fd" })} className={clsx(ghostBtn, "flex items-center gap-1.5")}>
            <Plus className="h-4 w-4" /> Saving
          </button>
        }
      />
      <MoneyTabs />
      {loading ? (
        <SkeletonList rows={3} />
      ) : !list.length ? (
        <Empty
          icon={<PiggyBank className="h-6 w-6" />}
          title="Track your savings"
          text="Add FDs, RDs, mutual funds, stocks, gold, PPF… Record money you put in, interest or profit as it grows, and see what you've earned."
          action={
            <button data-submit className={primaryBtn} onClick={() => setEditing({ kind: "fd" })}>
              Add first saving
            </button>
          }
        />
      ) : (
        <>
          <div className="card relative mb-5 rounded-3xl bg-gradient-to-br from-emerald-500/15 via-teal-500/5 to-transparent p-5">
            <HideAmountsButton className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg text-subtle hover:bg-raised hover:text-fg" />
            <p className="text-xs text-muted">Total savings</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{formatINR(t?.valuePaise || 0)}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-muted">You put in</p>
                <p className="font-semibold tabular-nums">{formatINR(t?.investedPaise || 0)}</p>
              </div>
              <div>
                <p className="text-muted">Earned</p>
                <p className={clsx("font-semibold tabular-nums", (t?.growthPaise || 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500")}>
                  {signed(t?.growthPaise || 0)}
                  <span className="font-normal">{pct(t?.returnPct ?? null)}</span>
                </p>
              </div>
              <div>
                <p className="text-muted">This year</p>
                <p className={clsx("font-semibold tabular-nums", (t?.earnedThisYear || 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500")}>{signed(t?.earnedThisYear || 0)}</p>
              </div>
            </div>
          </div>
          <Section title="Your savings">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
              {list.map((s) => {
                const m = meta(s.kind);
                const left = s.maturityDate ? daysTo(s.maturityDate) : null;
                return (
                  <button key={s.id} onClick={() => setOpenId(s.id)} className="card flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left hover:bg-raised">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-lg">{m.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{s.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {[s.institution || m.label, s.ratePct && `${s.ratePct}%${s.interestFreq ? ` ${INTEREST_LABEL[s.interestFreq]}` : ""}`, left !== null && (left < 0 ? "matured" : left === 0 ? "matures today" : `matures in ${left}d`)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-semibold tabular-nums">{formatINR(s.valuePaise)}</span>
                      {s.growthPaise !== 0 && (
                        <span className={clsx("block text-xs tabular-nums", s.growthPaise > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500")}>
                          {signed(s.growthPaise)}
                          {pct(s.returnPct)}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>
          <AutopayList kind="sip" />
          <p className="text-xs text-muted">
            Tap a saving to add money, record interest or profit, or update what it&apos;s worth today. Money moved from your bank is a transfer, so it never counts as spending.
          </p>
        </>
      )}
      {!loading && !list.length && (
        <div className="mt-5">
          <AutopayList kind="sip" />
        </div>
      )}
      {editing && <SavingForm initial={editing} onClose={() => setEditing(null)} />}
      {openId && (
        <SavingDetail
          id={openId}
          onClose={() => setOpenId(null)}
          onEdit={(s) => {
            setOpenId(null);
            setEditing(s);
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------- one saving

function SavingDetail({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (s: Saving) => void }) {
  const { data, loading, reload } = useData<{ saving: Saving & { entries: Entry[] } }>(`/api/savings/${id}`);
  const hidden = useHidden();
  const del = useUndoDelete();
  const [adding, setAdding] = useState<EntryKind | null>(null);
  const { toast } = useToast();
  const s = data?.saving;
  const m = s ? meta(s.kind) : SAVING_KINDS.other;
  const market = s ? MARKET_KINDS.includes(s.kind) : false;
  const entries = (s?.entries || []).filter((e) => !hidden.has(e.id));

  if (adding && s) return <EntryForm saving={s} kind={adding} onClose={() => (setAdding(null), reload())} />;

  const actions: { k: EntryKind; label: string; icon: React.ReactNode }[] = [
    ...(market ? [{ k: "value" as const, label: "Update value", icon: <RefreshCw className="h-4 w-4" /> }] : []),
    { k: "deposit", label: "Add money", icon: <ArrowDownLeft className="h-4 w-4" /> },
    { k: "growth", label: `${m.growth}${market ? " / loss" : ""}`, icon: <Sparkles className="h-4 w-4" /> },
    ...(!market ? [{ k: "value" as const, label: "Update value", icon: <RefreshCw className="h-4 w-4" /> }] : []),
    { k: "withdraw", label: "Take out", icon: <ArrowUpRight className="h-4 w-4" /> },
  ];

  return (
    <Modal title={s ? `${m.emoji} ${s.name}` : "Saving"} onClose={onClose}>
      {loading || !s ? (
        <SkeletonList rows={3} />
      ) : (
        <>
          <p className="-mt-2 mb-4 text-sm text-muted">
            {[m.label, s.institution, s.ratePct && `${s.ratePct}% a year`, s.maturityDate && `matures ${shortDate(s.maturityDate)}`].filter(Boolean).join(" · ")}
          </p>
          <div className="card rounded-2xl p-4">
            <p className="text-xs text-muted">Worth now</p>
            <p className="text-2xl font-semibold tabular-nums">{formatINR(s.valuePaise)}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span className="text-muted">
                You put in <b className="text-fg">{formatINR(s.investedPaise)}</b>
              </span>
              <span className={s.growthPaise >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}>
                {s.growthPaise >= 0 ? <TrendingUp className="mr-0.5 inline h-3.5 w-3.5" /> : <TrendingDown className="mr-0.5 inline h-3.5 w-3.5" />}
                {signed(s.growthPaise)}
                {pct(s.returnPct)}
              </span>
            </div>
            {s.nextInterest && (
              <p className="mt-2 text-xs text-muted">
                📈 Next interest about <b className="text-emerald-600 dark:text-emerald-400">{formatINR(s.nextInterest.paise)}</b> on {shortDate(s.nextInterest.date)}
                {s.interestAccountId ? " (paid out to your bank)" : " (added by itself)"}
              </p>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {actions.map((a, i) => (
              <button
                key={a.k}
                onClick={() => setAdding(a.k)}
                className={clsx(i === 0 ? primaryBtn : ghostBtn, "flex items-center justify-center gap-1.5 !py-2.5")}
              >
                {a.icon} {a.label}
              </button>
            ))}
          </div>

          <div className="mt-5">
            <AutopayList kind="sip" savingId={s.id} />
          </div>
          <label className={label}>History</label>
          {!entries.length ? (
            <p className="text-sm text-muted">Nothing yet.</p>
          ) : (
            <div className="card divide-y divide-line overflow-hidden rounded-2xl">
              {entries.map((e) => {
                const growth = e.type === "growth";
                const sign = e.type === "withdraw" ? -1 : 1;
                const amount = sign * e.amountPaise;
                return (
                  <div key={e.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <span
                      className={clsx(
                        "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                        growth ? (e.amountPaise >= 0 ? "bg-emerald-500/15 text-emerald-500" : "bg-rose-500/15 text-rose-500") : e.type === "deposit" ? "bg-indigo-500/15 text-indigo-500" : "bg-amber-500/15 text-amber-500",
                      )}
                    >
                      {growth ? e.amountPaise >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" /> : e.type === "deposit" ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{growth ? (e.amountPaise >= 0 ? m.growth : "Loss") : e.type === "deposit" ? "Added" : "Taken out"}</p>
                      <p className="truncate text-xs text-muted">
                        {shortDate(e.date)}
                        {e.note ? ` · ${e.note}` : ""}
                        {e.transactionId ? " · bank" : ""}
                      </p>
                    </div>
                    <span className={clsx("text-sm font-semibold tabular-nums", growth && (e.amountPaise >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"))}>{signed(amount)}</span>
                    {e.transactionId && (
                      <button
                        onClick={() =>
                          api(`/api/saving-entries/${e.id}`, { method: "PATCH", json: { unlink: true } }).then(() => {
                            refreshAll();
                            reload();
                            toast({ message: "Unlinked: the bank balance is back as it was" });
                          })
                        }
                        className="p-1 text-subtle hover:text-indigo-500"
                        aria-label="Not from my bank"
                        title="Not from my bank (unlink)"
                      >
                        <Unlink className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => del(e.id, "Entry removed", `/api/saving-entries/${e.id}`, reload)}
                      className="p-1 text-subtle hover:text-rose-500"
                      aria-label="Remove entry"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button onClick={() => onEdit(s)} className={clsx(ghostBtn, "flex items-center gap-1.5")}>
              <Pencil className="h-4 w-4" /> Edit
            </button>
            <button
              onClick={() => {
                del(s.id, `${s.name} deleted`, `/api/savings/${s.id}`);
                onClose();
              }}
              className={clsx(ghostBtn, "flex items-center gap-1.5 text-rose-500")}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------- add money / interest / value / take out

function EntryForm({ saving, kind, onClose }: { saving: Saving; kind: EntryKind; onClose: () => void }) {
  const { busy, run } = useSubmit();
  const accounts = useData<{ accounts: Account[] }>("/api/accounts").data?.accounts.filter((a) => a.kind !== "card") || [];
  const m = meta(saving.kind);
  const [amount, setAmount] = useState(kind === "value" ? String(saving.valuePaise / 100) : "");
  const [loss, setLoss] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [note, setNote] = useState("");
  const [accountId, setAccountId] = useState("");
  const n = Number(amount) || 0;
  const diff = kind === "value" ? Math.round(n * 100) - saving.valuePaise : 0;
  const title = kind === "deposit" ? "Add money" : kind === "withdraw" ? "Take money out" : kind === "value" ? "What's it worth today?" : `${m.growth} or loss`;
  const ok =
    kind === "deposit" ? "Added 💰" : kind === "withdraw" ? "Taken out" : kind === "value" ? (diff >= 0 ? `Profit ${formatINR(diff)} recorded 📈` : `Loss ${formatINR(-diff)} recorded`) : loss ? "Loss recorded" : `${m.growth} added 📈`;
  return (
    <Modal title={`${title} · ${saving.name}`} onClose={onClose}>
      <div className="grid gap-4">
        {kind === "growth" && (
          <div className="flex rounded-xl bg-raised p-1 text-sm font-medium">
            {[false, true].map((l) => (
              <button
                key={String(l)}
                type="button"
                onClick={() => setLoss(l)}
                className={clsx("flex-1 rounded-lg py-2", loss === l ? (l ? "bg-rose-500 text-white" : "bg-emerald-500 text-white") : "text-muted")}
              >
                {l ? "📉 Loss" : `📈 ${m.growth}`}
              </button>
            ))}
          </div>
        )}
        <div>
          <label className={label}>{kind === "value" ? "Current value (₹)" : "Amount (₹)"}</label>
          <input
            className={clsx(field, "text-lg font-semibold")}
            autoFocus
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          />
          {kind === "value" && n > 0 && (
            <p className={clsx("mt-1.5 text-xs", diff > 0 ? "text-emerald-600 dark:text-emerald-400" : diff < 0 ? "text-rose-500" : "text-muted")}>
              {diff === 0 ? "Same as before" : `${diff > 0 ? "Profit" : "Loss"} of ${formatINR(Math.abs(diff))} since the last value (${formatINR(saving.valuePaise)})`}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Date</label>
            <input className={field} type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
          </div>
          {(kind === "deposit" || kind === "withdraw") && accounts.length > 0 ? (
            <div>
              <label className={label}>{kind === "deposit" ? "Paid from" : "Money went to"}</label>
              <select className={field} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Don&apos;t link</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {ACCOUNT_META[a.kind].emoji} {a.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className={label}>Note</label>
              <input className={field} placeholder={kind === "growth" ? "e.g. Q3 interest" : "Optional"} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
        </div>
        {kind === "deposit" && accountId && n > 0 && (() => {
          const a = accounts.find((x) => x.id === accountId);
          const after = a ? a.balancePaise - Math.round(n * 100) : 0;
          return a && after < 0 ? (
            <p className="-mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              ⚠️ {a.name} has {formatINR(a.balancePaise)}: this takes it to {formatINR(after)}. If the money was already in {saving.name} (you&apos;re just recording it), pick <b>Don&apos;t link</b>.
            </p>
          ) : null;
        })()}
        {(kind === "deposit" || kind === "withdraw") && accounts.length > 0 && (
          <div>
            <label className={label}>Note</label>
            <input className={field} placeholder={kind === "deposit" ? "e.g. November SIP" : "Optional"} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
        <button
          data-submit
          className={primaryBtn}
          disabled={busy || !n || (kind === "value" && diff === 0)}
          onClick={() =>
            run(
              () => api(`/api/savings/${saving.id}`, { method: "POST", json: { type: kind, amount: n, loss, date, note: note || null, accountId: accountId || null } }),
              ok,
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

// ------------------------------------------------------------- add / edit a saving

function SavingForm({ initial, onClose }: { initial: Partial<Saving>; onClose: () => void }) {
  const { busy, run } = useSubmit();
  const accounts = useData<{ accounts: Account[] }>("/api/accounts").data?.accounts.filter((a) => a.kind !== "card") || [];
  const [kind, setKind] = useState<SavingKind>(initial.kind || "fd");
  const [name, setName] = useState(initial.name || "");
  const [institution, setInstitution] = useState(initial.institution || "");
  const [rate, setRate] = useState(initial.ratePct || "");
  const [maturity, setMaturity] = useState(initial.maturityDate || "");
  const [start, setStart] = useState("");
  const [fromAccountId, setFromAccountId] = useState("");
  const edit = Boolean(initial.id);
  const fixed = ["fd", "rd", "ppf", "savings", "chit", "other"].includes(kind);
  const [interestFreq, setInterestFreq] = useState<InterestFreq | "">(initial.interestFreq || "");
  const [interestTo, setInterestTo] = useState(initial.interestAccountId || "");
  const [interestFrom, setInterestFrom] = useState(initial.interestFrom || new Date().toLocaleDateString("en-CA"));
  const body = {
    name,
    kind,
    institution: institution || null,
    ratePct: rate ? Number(rate) : null,
    maturityDate: maturity || null,
    notes: initial.notes || null,
    interestFreq: fixed && rate && interestFreq ? interestFreq : null,
    interestAccountId: fixed && rate && interestFreq ? interestTo || null : null,
    interestFrom: fixed && rate && interestFreq ? interestFrom : null,
    ...(edit ? {} : { startAmount: Number(start) || null, fromAccountId: fromAccountId || null }),
  };
  return (
    <Modal title={edit ? "Edit saving" : "New saving"} onClose={onClose}>
      <div className="grid gap-4">
        <div className="grid grid-cols-5 gap-1.5">
          {(Object.keys(SAVING_KINDS) as SavingKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={clsx("rounded-xl border px-0.5 py-2 text-[11px] font-medium leading-tight", kind === k ? "border-emerald-400 bg-emerald-500/15" : "border-line text-muted")}
            >
              <span className="block text-lg">{SAVING_KINDS[k].emoji}</span>
              {SAVING_KINDS[k].label.split(" /")[0].replace("Recurring deposit", "RD").replace("Fixed deposit", "FD").replace("Savings account", "Savings a/c")}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Name</label>
            <input className={field} autoFocus placeholder={kind === "fd" ? "e.g. SBI FD 2027" : kind === "mutual_fund" ? "e.g. Nifty 50 index" : "Name"} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={label}>Bank / app</label>
            <input className={field} placeholder={kind === "mutual_fund" || kind === "stocks" ? "e.g. Zerodha" : "e.g. SBI"} value={institution} onChange={(e) => setInstitution(e.target.value)} />
          </div>
        </div>
        {fixed && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Interest (% a year)</label>
              <input className={field} type="text" inputMode="decimal" placeholder="e.g. 7.1" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))} />
            </div>
            <div>
              <label className={label}>Matures on</label>
              <input className={field} type="date" value={maturity} onChange={(e) => setMaturity(e.target.value)} />
            </div>
          </div>
        )}
        {fixed && Number(rate) > 0 && (
          <div className="grid gap-3 rounded-2xl border border-line p-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Add interest</label>
                <select className={field} value={interestFreq} onChange={(e) => setInterestFreq(e.target.value as InterestFreq | "")}>
                  <option value="">I&apos;ll add it myself</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="halfyearly">Half-yearly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              {interestFreq && (
                <div>
                  <label className={label}>Counting from</label>
                  <input className={field} type="date" value={interestFrom} onChange={(e) => setInterestFrom(e.target.value)} />
                </div>
              )}
            </div>
            {interestFreq && (
              <>
                <div>
                  <label className={label}>Interest goes</label>
                  <select className={field} value={interestTo} onChange={(e) => setInterestTo(e.target.value)}>
                    <option value="">Stays in it (grows / compounds)</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        Paid out to {ACCOUNT_META[a.kind].emoji} {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-muted">
                  {rate}% a year is added {INTEREST_LABEL[interestFreq]} on the {ordinalDay(Number(interestFrom.slice(8)))} (from {shortDate(interestFrom)}), on what&apos;s in it at the time{maturity ? `, until it matures` : ""}. Only future interest is added, never back-dated. You can still add or fix interest yourself.
                </p>
              </>
            )}
          </div>
        )}
        {!edit && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Amount in it today (₹)</label>
              <input className={field} type="text" inputMode="decimal" placeholder="0" value={start} onChange={(e) => setStart(e.target.value.replace(/[^\d.]/g, ""))} />
            </div>
            {accounts.length > 0 && (
              <div>
                <label className={label}>Paid from</label>
                <select className={field} value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
                  <option value="">Already saved</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {ACCOUNT_META[a.kind].emoji} {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
        {fixed && maturity && <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">You&apos;ll get a reminder a week before it matures and on the day.</p>}
        <button
          data-submit
          className={primaryBtn}
          disabled={busy || !name.trim()}
          onClick={() =>
            run(
              () => (edit ? api(`/api/savings/${initial.id}`, { method: "PATCH", json: body }) : api("/api/savings", { method: "POST", json: body })),
              edit ? "Saving updated" : "Saving added 🐖",
              () => (onClose(), refreshAll()),
            )
          }
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
        </button>
      </div>
    </Modal>
  );
}
