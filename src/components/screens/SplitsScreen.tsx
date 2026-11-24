"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { Check, ChevronRight, Loader2, Pencil, Plus, Split, Trash2, Users } from "lucide-react";
import { api, openSplit, refreshAll, SPLIT_EVENT, useData } from "@/components/app/client";
import { Empty, PageTitle, Section, SkeletonList } from "@/components/app/rows";
import { MoneyTabs } from "@/components/app/MoneyTabs";
import { useSheet } from "@/components/app/AddSheet";
import { useToast } from "@/components/app/toast";
import { field, label } from "@/components/app/ReminderEditor";
import { dueShareText, ShareButton } from "@/components/app/Share";
import { Avatar, displayName, previewSplit, SplitEditor, type SplitValue } from "@/components/app/SplitEditor";
import { DueForm, Modal, ghostBtn, primaryBtn } from "@/components/screens/MoneyPlus";
import { categoryMeta, EXPENSE_CATEGORIES } from "@/components/types";
import { formatINR } from "@/lib/money";

type Due = { id: string; person: string; direction: "they_owe" | "i_owe"; amountPaise: number; note: string | null; settledAt: string | null; splitId: string | null; createdAt: string };
type SplitRow = {
  id: string;
  title: string;
  totalPaise: number;
  category: string;
  date: string;
  paidBy: string;
  method: SplitValue["method"];
  shares: { person: string; value: number; sharePaise: number }[];
  myPaise: number;
  accountId: string | null;
  dues: Due[];
  backPaise: number;
  owedPaise: number;
};
type Person = { person: string; theyOwe: number; iOwe: number; net: number; items: { id: string; title: string; amountPaise: number; direction: string }[] };
type Overview = { theyOwe: number; iOwe: number; people: Person[]; splits: SplitRow[]; loose: Due[]; groups: { id: string; name: string; members: string[] }[]; known: string[] };

const shortDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const ago = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return days <= 0 ? "today" : days === 1 ? "since yesterday" : `since ${days} days`;
};

// ------------------------------------------------------------- Splits tab

export function SplitsScreen() {
  const { data, loading } = useData<Overview>("/api/splits");
  const { open } = useSheet();
  const { toast } = useToast();
  const [iou, setIou] = useState(false);
  const [groups, setGroups] = useState(false);
  const [settling, setSettling] = useState<string | null>(null);

  const settleUp = async (p: Person) => {
    setSettling(p.person);
    try {
      await api("/api/dues/settle-person", { method: "POST", json: { person: p.person } });
      toast({ message: p.net >= 0 ? `Settled up with ${p.person} · ${formatINR(p.theyOwe)} logged as paid back` : `Marked as paid to ${p.person}` });
      refreshAll();
    } catch (e) {
      toast({ message: (e as Error).message, tone: "error" });
    } finally {
      setSettling(null);
    }
  };

  const people = data?.people || [];
  const splits = data?.splits || [];
  const loose = (data?.loose || []).filter((d) => !d.settledAt);

  return (
    <div>
      <PageTitle title="Money" subtitle="Split bills and who owes whom" />
      <MoneyTabs />

      {loading ? (
        <SkeletonList rows={4} />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3">
            <div className="card rounded-2xl p-4">
              <p className="text-xs text-muted">You&apos;ll get back</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatINR(data?.theyOwe || 0)}</p>
              <p className="text-xs text-muted">
                {people.filter((p) => p.theyOwe).length ? `from ${people.filter((p) => p.theyOwe).length} ${people.filter((p) => p.theyOwe).length === 1 ? "person" : "people"}` : "Nobody owes you"}
              </p>
            </div>
            <div className="card rounded-2xl p-4">
              <p className="text-xs text-muted">You owe</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">{formatINR(data?.iOwe || 0)}</p>
              <p className="truncate text-xs text-muted">
                {people.filter((p) => p.iOwe).length ? people.filter((p) => p.iOwe).map((p) => p.person).join(", ") : "All clear"}
              </p>
            </div>
          </div>

          <div className="mb-5 grid grid-cols-2 gap-2">
            <button onClick={() => open({ mode: "expense", split: true })} className={clsx(primaryBtn, "flex items-center justify-center gap-1.5")}>
              <Split className="h-4 w-4" /> Split a bill
            </button>
            <button onClick={() => setIou(true)} className={clsx(ghostBtn, "flex items-center justify-center gap-1.5")}>
              <Plus className="h-4 w-4" /> Add IOU
            </button>
          </div>

          {people.length > 0 && (
            <Section title="People">
              <div className="card divide-y divide-line overflow-hidden rounded-2xl">
                {people.map((p) => (
                  <div key={p.person} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={p.person} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {p.person}{" "}
                        <span className={clsx("text-sm font-semibold", p.net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                          {p.net >= 0 ? `owes you ${formatINR(p.net)}` : `you owe ${formatINR(-p.net)}`}
                        </span>
                      </p>
                      <p className="truncate text-xs text-muted">
                        {p.items.length} {p.items.length === 1 ? "bill" : "bills"} · {p.items.map((i) => i.title).join(", ")}
                      </p>
                    </div>
                    <ShareButton
                      text={dueShareText({ person: p.person, direction: p.net >= 0 ? "they_owe" : "i_owe", amountPaise: Math.abs(p.net), note: p.items.length === 1 ? p.items[0].title : null })}
                      title={p.net >= 0 ? `Remind ${p.person}` : `Message ${p.person}`}
                      label=""
                      className="grid h-8 w-8 place-items-center rounded-lg text-subtle hover:text-indigo-500"
                    />
                    <button
                      disabled={settling === p.person}
                      onClick={() => settleUp(p)}
                      className="flex items-center gap-1 rounded-lg bg-raised px-2.5 py-1.5 text-xs font-semibold hover:bg-line disabled:opacity-50"
                    >
                      {settling === p.person && <Loader2 className="h-3 w-3 animate-spin" />}
                      {p.net >= 0 ? "Settle up" : "Paid"}
                    </button>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section
            title="Recent splits"
            right={
              <button onClick={() => setGroups(true)} className="flex items-center gap-1 text-indigo-500">
                <Users className="h-3.5 w-3.5" /> Groups
              </button>
            }
          >
            {!splits.length ? (
              <Empty
                icon={<Split className="h-6 w-6" />}
                title="Split your first bill"
                text={`Add an expense and turn on "Split this bill", swipe an expense right, or just say "Paid 1200 for dinner with Arun and Riya, split equally".`}
                action={
                  <button className={primaryBtn} onClick={() => open({ mode: "expense", split: true })}>
                    Split a bill
                  </button>
                }
              />
            ) : (
              <div className="card divide-y divide-line overflow-hidden rounded-2xl">
                {splits.map((s) => {
                  const theyOwe = s.dues.filter((d) => d.direction === "they_owe");
                  const iOwe = s.dues.find((d) => d.direction === "i_owe");
                  return (
                    <button key={s.id} onClick={() => openSplit(s.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-raised">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500/15 text-lg">{categoryMeta(s.category).emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{s.title}</p>
                        <p className="text-xs text-muted">
                          {shortDate(s.date)} · {s.shares.length} people{s.paidBy !== "me" ? ` · ${s.paidBy} paid` : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums">{formatINR(s.totalPaise)}</p>
                        <p className={clsx("text-xs", iOwe && !iOwe.settledAt ? "text-amber-600" : theyOwe.every((d) => d.settledAt) ? "text-emerald-600 dark:text-emerald-400" : "text-muted")}>
                          {iOwe
                            ? iOwe.settledAt
                              ? "you paid"
                              : `you owe ${formatINR(iOwe.amountPaise)}`
                            : theyOwe.every((d) => d.settledAt)
                              ? "all paid back"
                              : `${theyOwe.filter((d) => d.settledAt).length}/${theyOwe.length} paid back`}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-subtle" />
                    </button>
                  );
                })}
              </div>
            )}
          </Section>

          {loose.length > 0 && (
            <Section title="Other dues">
              <div className="card divide-y divide-line overflow-hidden rounded-2xl">
                {loose.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={d.person} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{d.direction === "they_owe" ? `${d.person} owes you` : `You owe ${d.person}`}</p>
                      <p className="truncate text-xs text-muted">{d.note || "No note"}</p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{formatINR(d.amountPaise)}</span>
                    <TickButton due={d} />
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
      {iou && <DueForm onClose={() => setIou(false)} />}
      {groups && <GroupsSheet groups={data?.groups || []} onClose={() => setGroups(false)} />}
    </div>
  );
}

// ------------------------------------------------------------- tick off

function TickButton({ due, onChanged }: { due: Due; onChanged?: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      if (due.settledAt) {
        await api(`/api/dues/${due.id}`, { method: "PATCH", json: { settled: false } });
        toast({ message: `${displayName(due.person)} marked as not paid` });
      } else {
        await api(`/api/dues/${due.id}`, { method: "POST", json: { log: true } });
        toast({
          message: due.direction === "they_owe" ? `${due.person} paid back ${formatINR(due.amountPaise)} · added as income` : `Marked as paid to ${due.person}`,
          action: { label: "Undo", onClick: () => api(`/api/dues/${due.id}`, { method: "PATCH", json: { settled: false } }).then(() => (refreshAll(), onChanged?.())) },
        });
      }
      refreshAll();
      onChanged?.();
    } catch (e) {
      toast({ message: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-label={due.settledAt ? `Mark ${due.person} as not paid` : `Mark ${due.person} as paid`}
      className={clsx(
        "grid h-8 w-8 shrink-0 place-items-center rounded-full transition",
        due.settledAt ? "bg-emerald-500 text-white" : "border-2 border-line hover:border-emerald-500",
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : due.settledAt ? <Check className="h-4 w-4" /> : null}
    </button>
  );
}

// ------------------------------------------------------------- detail sheet

/** Listens for openSplit(id) and shows that bill. Mounted once in the app shell. */
export function SplitDetailHost() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setId((e as CustomEvent<string>).detail);
    window.addEventListener(SPLIT_EVENT, on);
    return () => window.removeEventListener(SPLIT_EVENT, on);
  }, []);
  if (!id) return null;
  return <SplitDetail key={id} id={id} onClose={() => setId(null)} />;
}

function SplitDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, reload } = useData<{ split: SplitRow }>(`/api/splits/${id}`);
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const s = data?.split;

  if (editing && s) return <SplitEditSheet split={s} onClose={() => (setEditing(false), reload())} />;

  const theyOwe = s?.dues.filter((d) => d.direction === "they_owe") || [];
  const iOwe = s?.dues.find((d) => d.direction === "i_owe");
  const open = theyOwe.filter((d) => !d.settledAt);
  const pct = s && s.owedPaise ? Math.round((s.backPaise / s.owedPaise) * 100) : 0;

  return (
    <Modal title={s?.title || "Split"} onClose={onClose}>
      {loading || !s ? (
        <SkeletonList rows={3} />
      ) : (
        <>
          <p className="-mt-2 mb-4 text-sm text-muted">
            {new Date(`${s.date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} · {categoryMeta(s.category).emoji} {s.category} · paid by{" "}
            {displayName(s.paidBy)}
          </p>
          <div className="card rounded-2xl p-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-muted">Bill</p>
                <p className="text-2xl font-semibold tabular-nums">{formatINR(s.totalPaise)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted">Your share</p>
                <p className="text-lg font-semibold tabular-nums">{formatINR(s.myPaise)}</p>
              </div>
            </div>
            {s.paidBy === "me" ? (
              <>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-raised">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-muted">
                  <b className="text-emerald-600 dark:text-emerald-400">{formatINR(s.backPaise)}</b> of {formatINR(s.owedPaise)} back
                  {s.owedPaise - s.backPaise > 0 ? ` · ${formatINR(s.owedPaise - s.backPaise)} to go` : " · all settled 🎉"}
                </p>
              </>
            ) : (
              <p className="mt-3 text-xs text-muted">
                {iOwe?.settledAt ? (
                  <b className="text-emerald-600 dark:text-emerald-400">You paid {s.paidBy} back</b>
                ) : (
                  <>
                    You owe {s.paidBy} <b className="text-amber-600 dark:text-amber-400">{formatINR(s.myPaise)}</b>
                  </>
                )}
              </p>
            )}
          </div>

          <label className={clsx(label, "mt-5")}>{s.paidBy === "me" ? "Who owes you" : "Everyone's share"}</label>
          <div className="card divide-y divide-line overflow-hidden rounded-2xl">
            {s.paidBy === "me"
              ? theyOwe.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={d.person} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{d.person}</p>
                      <p className={clsx("text-xs", d.settledAt ? "text-emerald-600 dark:text-emerald-400" : "text-muted")}>
                        {d.settledAt ? `Paid back · ${new Date(d.settledAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : `Owes ${ago(d.createdAt)}`}
                      </p>
                    </div>
                    <span className={clsx("text-sm font-semibold tabular-nums", d.settledAt && "text-muted line-through")}>{formatINR(d.amountPaise)}</span>
                    <TickButton due={d} onChanged={reload} />
                  </div>
                ))
              : s.shares.map((sh) => (
                  <div key={sh.person} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={sh.person} size={36} />
                    <p className="min-w-0 flex-1 font-medium">
                      {displayName(sh.person)}
                      {sh.person === s.paidBy && <span className="ml-1.5 text-xs font-normal text-muted">paid the bill</span>}
                    </p>
                    <span className="text-sm font-semibold tabular-nums">{formatINR(sh.sharePaise)}</span>
                    {sh.person === "me" && iOwe && <TickButton due={iOwe} onChanged={reload} />}
                  </div>
                ))}
          </div>
          {s.paidBy === "me" && open.length > 0 && (
            <p className="mt-2 text-center text-xs text-muted">Tap a circle when someone pays you back. It&apos;s added as income (Refund).</p>
          )}
          {s.paidBy === "me" && open.length === 1 && (
            <div className="mt-2 flex gap-2">
              <ShareButton
                text={dueShareText(open[0])}
                title={`Remind ${open[0].person}`}
                label={`Remind ${open[0].person}`}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-line py-2.5 text-sm font-medium"
              />
            </div>
          )}
          {s.paidBy === "me" && open.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {open.map((d) => (
                <ShareButton
                  key={d.id}
                  text={dueShareText(d)}
                  title={`Remind ${d.person}`}
                  label={`Remind ${d.person}`}
                  className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-medium"
                />
              ))}
            </div>
          )}

          {confirmDelete ? (
            <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/5 p-3">
              <p className="mb-2 text-sm font-medium">Delete this split?</p>
              <div className="grid gap-2">
                <button
                  className="rounded-xl border border-line py-2.5 text-sm"
                  onClick={async () => {
                    await api(`/api/splits/${s.id}`, { method: "DELETE" });
                    toast({ message: s.paidBy === "me" ? "Split removed · the expense stays in Entries" : "Split removed" });
                    refreshAll();
                    onClose();
                  }}
                >
                  {s.paidBy === "me" ? "Remove the split, keep the expense" : "Remove it"}
                </button>
                {s.paidBy === "me" && (
                  <button
                    className="rounded-xl bg-rose-500 py-2.5 text-sm font-semibold text-white"
                    onClick={async () => {
                      await api(`/api/splits/${s.id}?expense=1`, { method: "DELETE" });
                      toast({ message: "Bill deleted" });
                      refreshAll();
                      onClose();
                    }}
                  >
                    Delete the whole bill
                  </button>
                )}
                <button className="py-1 text-xs text-muted" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-5 flex gap-2">
              <button onClick={() => setEditing(true)} className={clsx(ghostBtn, "flex items-center gap-1.5")}>
                <Pencil className="h-4 w-4" /> Edit split
              </button>
              <button onClick={() => setConfirmDelete(true)} className={clsx(ghostBtn, "flex items-center gap-1.5 text-rose-500")}>
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------- edit

function SplitEditSheet({ split, onClose }: { split: SplitRow; onClose: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState(split.title);
  const [amount, setAmount] = useState(split.totalPaise / 100);
  const [date, setDate] = useState(split.date);
  const [category, setCategory] = useState(split.category);
  const [value, setValue] = useState<SplitValue>({ paidBy: split.paidBy, method: split.method, people: split.shares.map((s) => ({ person: s.person, value: s.value })) });
  const [busy, setBusy] = useState(false);
  const preview = previewSplit(amount, value);
  const cats = EXPENSE_CATEGORIES.includes(category) ? EXPENSE_CATEGORIES : [...EXPENSE_CATEGORIES, category];
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/splits/${split.id}`, { method: "PATCH", json: { title, amount, date, category, paidBy: value.paidBy, method: value.method, people: value.people } });
      toast({ message: "Split updated" });
      refreshAll();
      onClose();
    } catch (e) {
      toast({ message: (e as Error).message, tone: "error" });
      setBusy(false);
    }
  };
  return (
    <Modal title="Edit split" onClose={onClose}>
      <div className="grid gap-3">
        <div className="grid grid-cols-[1fr_8rem] gap-3">
          <div>
            <label className={label}>What for</label>
            <input className={field} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className={label}>Bill (₹)</label>
            <input className={field} type="number" inputMode="decimal" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value) || 0)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Date</label>
            <input className={field} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className={label}>Category</label>
            <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
              {cats.map((c) => (
                <option key={c} value={c}>
                  {categoryMeta(c).emoji} {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <SplitEditor total={amount} value={value} onChange={setValue} />
        <p className="text-xs text-muted">People who already paid stay ticked; their payback follows the new amount.</p>
        <button data-submit className={primaryBtn} disabled={busy || Boolean(preview.error) || !title.trim()} onClick={save}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------- groups

function GroupsSheet({ groups, onClose }: { groups: { id: string; name: string; members: string[] }[]; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [members, setMembers] = useState("");
  const call = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast({ message: msg });
      refreshAll();
    } catch (e) {
      toast({ message: (e as Error).message, tone: "error" });
    }
  };
  return (
    <Modal title="Groups" onClose={onClose}>
      <p className="mb-3 text-sm text-muted">Save people you often split with. Tap a group in the split form to add everyone at once.</p>
      {groups.length > 0 && (
        <div className="card mb-4 divide-y divide-line overflow-hidden rounded-2xl">
          {groups.map((g) => (
            <div key={g.id} className="flex items-center gap-3 px-4 py-3">
              <Users className="h-4 w-4 text-indigo-500" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{g.name}</p>
                <p className="truncate text-xs text-muted">{g.members.join(", ")}</p>
              </div>
              <button onClick={() => call(() => api(`/api/split-groups?id=${g.id}`, { method: "DELETE" }), "Group removed")} className="p-1.5 text-subtle hover:text-rose-500" aria-label={`Remove ${g.name}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-3">
        <div>
          <label className={label}>Group name</label>
          <input className={field} maxLength={40} placeholder="Flatmates, Goa trip…" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={label}>People (comma separated, not you)</label>
          <input className={field} placeholder="Arun, Riya, Manu" value={members} onChange={(e) => setMembers(e.target.value)} />
        </div>
        <button
          data-submit
          className={primaryBtn}
          disabled={!name.trim() || !members.trim()}
          onClick={() =>
            call(
              () =>
                api("/api/split-groups", {
                  method: "POST",
                  json: { name, members: members.split(",").map((m) => m.trim()).filter(Boolean) },
                }).then(() => {
                  setName("");
                  setMembers("");
                }),
              "Group saved",
            )
          }
        >
          Save group
        </button>
      </div>
    </Modal>
  );
}
