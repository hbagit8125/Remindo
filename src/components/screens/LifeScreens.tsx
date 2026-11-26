"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { clsx } from "clsx";
import {
  ArrowLeft,
  BookOpen,
  Cake,
  Check,
  FileText,
  GraduationCap,
  ListChecks,
  MapPin,
  Pill,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { api, refreshAll, relativeDay, useData, useHidden } from "@/components/app/client";
import { Empty, ItemRow, PageTitle, ReminderItem, rowIcon, Section, SkeletonList, useNow, useReminderActions, useUndoDelete } from "@/components/app/rows";
import { SwipeHint } from "@/components/app/SwipeRow";
import { listShareText, ShareButton, ShareSheet } from "@/components/app/Share";
import type { AgendaItem } from "@/components/types";
import { useToast } from "@/components/app/toast";
import { field, label } from "@/components/app/ReminderEditor";
import { Modal, ghostBtn, primaryBtn, useSubmit } from "@/components/screens/MoneyPlus";
import { formatINR } from "@/lib/money";

// ------------------------------------------------------------- types

type Doc = { id: string; kind: string; name: string; number: string | null; expiryDate: string; renewalCostPaise: number | null; notes: string | null };
type Person = {
  id: string;
  name: string;
  relation: string | null;
  birthday: string | null;
  birthYear: number | null;
  anniversary: string | null;
  giftBudgetPaise: number | null;
  giftIdeas: string | null;
  notes: string | null;
  nextBirthday: string | null;
  daysToBirthday: number | null;
  turning: number | null;
  nextAnniversary: string | null;
  daysToAnniversary: number | null;
};
type Medicine = { id: string; name: string; dose: string | null; times: string[]; stock: number | null; perDose: number; refillAt: number };
type ListSummary = { id: string; name: string; emoji: string | null; kind: "list" | "note"; body: string | null; pinned: boolean; total: number; open: number; updatedAt: string };
type ListItem = { id: string; text: string; done: boolean };
type ListFull = ListSummary & { items: ListItem[] };
type StudyItem = { id: string; title: string; notes: string | null; dueAt: string; input: { date?: string } | null; status: string };

const DOC_LABEL: Record<string, string> = {
  vehicle_insurance: "🚗 Vehicle insurance",
  puc: "🌫️ PUC",
  licence: "🪪 Driving licence",
  passport: "🛂 Passport",
  health_insurance: "🏥 Health insurance",
  rc: "📄 RC",
  subscription: "🔁 Subscription",
  other: "📁 Other",
};

const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const daysTo = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${todayStr()}T00:00:00Z`)) / 86400000);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtMD = (md: string) => `${Number(md.slice(3))} ${MONTHS[Number(md.slice(0, 2)) - 1]}`;

export function Back({ href = "/more", text = "More" }: { href?: string; text?: string }) {
  return (
    <Link href={href} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
      <ArrowLeft className="h-4 w-4" /> {text}
    </Link>
  );
}

function AddBtn({ onClick, text }: { onClick: () => void; text: string }) {
  return (
    <button onClick={onClick} className={clsx(ghostBtn, "flex items-center gap-1.5")}>
      <Plus className="h-4 w-4" /> {text}
    </button>
  );
}

function Pill2({ tone, children }: { tone: "red" | "amber" | "green" | "muted"; children: React.ReactNode }) {
  return (
    <span
      className={clsx(
        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "red" && "bg-rose-500/15 text-rose-600 dark:text-rose-300",
        tone === "amber" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        tone === "green" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        tone === "muted" && "bg-raised text-muted",
      )}
    >
      {children}
    </span>
  );
}

// ------------------------------------------------------------- Life hub (shown on More)

export function LifeTiles() {
  const tiles = [
    { href: "/life/documents", icon: FileText, label: "Documents", tint: "text-sky-500 bg-sky-500/15" },
    { href: "/life/people", icon: Users, label: "People", tint: "text-pink-500 bg-pink-500/15" },
    { href: "/life/health", icon: Pill, label: "Health", tint: "text-emerald-500 bg-emerald-500/15" },
    { href: "/life/study", icon: GraduationCap, label: "Study", tint: "text-violet-500 bg-violet-500/15" },
    { href: "/lists", icon: ListChecks, label: "Notes & lists", tint: "text-teal-500 bg-teal-500/15" },
    { href: "/life/places", icon: MapPin, label: "Places", tint: "text-orange-500 bg-orange-500/15" },
  ];
  return (
    <Section title="Life">
      <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="card flex flex-col items-center gap-2 rounded-2xl px-2 py-4 text-center transition hover:bg-raised">
            <span className={clsx("grid h-10 w-10 place-items-center rounded-xl", t.tint)}>
              <t.icon className="h-5 w-5" />
            </span>
            <span className="text-xs font-medium">{t.label}</span>
          </Link>
        ))}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------- Documents

export function DocumentsScreen() {
  const { data, loading } = useData<{ documents: Doc[] }>("/api/documents");
  const [editing, setEditing] = useState<Partial<Doc> | null>(null);
  const [renewing, setRenewing] = useState<Doc | null>(null);
  const hidden = useHidden();
  const del = useUndoDelete();
  const docs = (data?.documents || []).filter((d) => !hidden.has(d.id));
  return (
    <div>
      <Back />
      <PageTitle title="Documents" subtitle="Expiry dates, renewals and reminders" right={<AddBtn onClick={() => setEditing({ kind: "vehicle_insurance" })} text="Add" />} />
      {loading ? (
        <SkeletonList rows={3} />
      ) : !docs.length ? (
        <Empty
          icon={<FileText className="h-6 w-6" />}
          title="Never miss a renewal"
          text="Add insurance, PUC, licence or passport. You'll be reminded 30 days, 7 days and 1 day before it expires."
          action={<button data-submit className={primaryBtn} onClick={() => setEditing({ kind: "vehicle_insurance" })}>Add a document</button>}
        />
      ) : (
        <>
          <SwipeHint text="Tip: swipe right when you've renewed something, left to delete it." />
          <div className="grid gap-2">
            {docs.map((d) => {
              const left = daysTo(d.expiryDate);
              return (
                <ItemRow
                  key={d.id}
                  icon={rowIcon("bg-sky-500/15 text-lg", (DOC_LABEL[d.kind] || "📁").split(" ")[0])}
                  title={d.name}
                  sub={[(DOC_LABEL[d.kind] || d.kind).replace(/^\S+\s/, ""), d.number, d.renewalCostPaise && `~${formatINR(d.renewalCostPaise)}`].filter(Boolean).join(" · ")}
                  badge={
                    <Pill2 tone={left <= 7 ? "red" : left <= 30 ? "amber" : "muted"}>
                      {left < 0 ? "Expired" : left === 0 ? "Today" : left <= 60 ? `${left}d left` : `${MONTHS[Number(d.expiryDate.slice(5, 7)) - 1]} '${d.expiryDate.slice(2, 4)}`}
                    </Pill2>
                  }
                  actions={
                    <button onClick={() => setRenewing(d)} className="rounded-lg px-2 py-1 text-xs font-medium text-indigo-500 hover:bg-raised">
                      Renewed
                    </button>
                  }
                  onOpen={() => setEditing(d)}
                  swipeRight={{ label: "Renewed", icon: <RefreshCw className="h-5 w-5" />, className: "bg-emerald-500", onTrigger: () => setRenewing(d) }}
                  swipeLeft={{ label: "Delete", icon: <Trash2 className="h-5 w-5" />, className: "bg-rose-500", onTrigger: () => del(d.id, `“${d.name}” deleted`, `/api/documents/${d.id}`) }}
                />
              );
            })}
          </div>
        </>
      )}
      {editing && <DocForm initial={editing} onClose={() => setEditing(null)} />}
      {renewing && <RenewForm doc={renewing} onClose={() => setRenewing(null)} />}
    </div>
  );
}

function DocForm({ initial, onClose }: { initial: Partial<Doc>; onClose: () => void }) {
  const { busy, run } = useSubmit();
  const [v, setV] = useState({
    kind: initial.kind || "other",
    name: initial.name || "",
    number: initial.number || "",
    expiryDate: initial.expiryDate || "",
    renewalCost: initial.renewalCostPaise ? String(initial.renewalCostPaise / 100) : "",
    notes: initial.notes || "",
  });
  const save = () =>
    run(
      () =>
        api(initial.id ? `/api/documents/${initial.id}` : "/api/documents", {
          method: initial.id ? "PATCH" : "POST",
          json: { ...v, renewalCost: v.renewalCost ? Number(v.renewalCost) : null },
        }),
      initial.id ? "Saved" : "Added. Renewal reminders are set",
      onClose,
    );
  return (
    <Modal title={initial.id ? "Edit document" : "New document"} onClose={onClose}>
      <div className="grid gap-3">
        <div>
          <label className={label}>Type</label>
          <select
            className={field}
            value={v.kind}
            onChange={(e) => setV({ ...v, kind: e.target.value })}
          >
            {Object.entries(DOC_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Name</label>
          <input
            className={field}
            maxLength={80}
            placeholder={v.kind === "other" ? "e.g. Activa insurance" : `e.g. ${(DOC_LABEL[v.kind] || "").replace(/^\S+\s/, "")}`}
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Expires on</label>
            <input type="date" className={field} value={v.expiryDate} onChange={(e) => setV({ ...v, expiryDate: e.target.value })} />
          </div>
          <div>
            <label className={label}>Renewal cost (₹)</label>
            <input type="number" inputMode="decimal" className={field} value={v.renewalCost} onChange={(e) => setV({ ...v, renewalCost: e.target.value })} />
          </div>
        </div>
        <div>
          <label className={label}>Number (optional)</label>
          <input className={field} value={v.number} onChange={(e) => setV({ ...v, number: e.target.value })} />
        </div>
        <div>
          <label className={label}>Notes</label>
          <input className={field} placeholder="Agent, policy provider…" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </div>
        <div className="flex gap-2 pt-1">
          {initial.id && (
            <button
              className={clsx(ghostBtn, "text-rose-500")}
              onClick={() => run(() => api(`/api/documents/${initial.id}`, { method: "DELETE" }), "Deleted", onClose)}
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button data-submit className={clsx(primaryBtn, "flex-1")} disabled={busy || !v.name || !v.expiryDate} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RenewForm({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const { busy, run } = useSubmit();
  const nextYear = (() => {
    const [y, m, d] = doc.expiryDate.split("-").map(Number);
    return `${y + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  })();
  const [expiry, setExpiry] = useState(nextYear);
  const [cost, setCost] = useState(doc.renewalCostPaise ? String(doc.renewalCostPaise / 100) : "");
  return (
    <Modal title={`Renewed ${doc.name}`} onClose={onClose}>
      <div className="grid gap-3">
        <div>
          <label className={label}>New expiry date</label>
          <input type="date" className={field} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </div>
        <div>
          <label className={label}>What did it cost? (logged as an expense)</label>
          <input type="number" inputMode="decimal" className={field} value={cost} onChange={(e) => setCost(e.target.value)} />
        </div>
        <button data-submit
          className={primaryBtn}
          disabled={busy || !expiry}
          onClick={() => run(() => api(`/api/documents/${doc.id}`, { method: "POST", json: { expiryDate: expiry, cost: cost ? Number(cost) : null } }), "Renewed. Reminders moved", onClose)}
        >
          <Check className="h-4 w-4" /> Save
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------- People

const wishText = (p: Person) => {
  const first = p.name.split(" ")[0];
  if (p.daysToAnniversary !== null && p.daysToAnniversary <= 1 && !(p.daysToBirthday !== null && p.daysToBirthday <= 1)) return `Happy anniversary, ${first}! 💍 Wishing you many more happy years together.`;
  return `Happy birthday, ${first}! 🎉${p.turning ? ` ${p.turning} looks great on you.` : ""} Have a wonderful year ahead.`;
};

export function PeopleScreen() {
  const { data, loading } = useData<{ people: Person[] }>("/api/people");
  const [editing, setEditing] = useState<Partial<Person> | null>(null);
  const [wishing, setWishing] = useState<Person | null>(null);
  const hidden = useHidden();
  const del = useUndoDelete();
  const people = (data?.people || []).filter((p) => !hidden.has(p.id));
  const soon = (n: number | null) => n !== null && n <= 30;
  return (
    <div>
      <Back />
      <PageTitle title="People" subtitle="Birthdays, anniversaries and gift ideas" right={<AddBtn onClick={() => setEditing({})} text="Add" />} />
      {loading ? (
        <SkeletonList rows={3} />
      ) : !people.length ? (
        <Empty
          icon={<Cake className="h-6 w-6" />}
          title="Remember every birthday"
          text="Add family and friends. You'll get a reminder a week before, the day before, and on the day, with your gift notes."
          action={<button data-submit className={primaryBtn} onClick={() => setEditing({})}>Add someone</button>}
        />
      ) : (
        <>
          <SwipeHint text="Tip: swipe right to send wishes, left to remove someone." />
          <div className="grid gap-2">
            {people.map((p) => (
              <ItemRow
                key={p.id}
                icon={<span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-pink-500/15 font-semibold text-pink-500">{p.name[0]?.toUpperCase()}</span>}
                title={
                  <>
                    {p.name}
                    {p.relation ? <span className="font-normal text-muted"> · {p.relation}</span> : null}
                  </>
                }
                sub={[p.birthday && `🎂 ${fmtMD(p.birthday)}${p.turning ? ` (turns ${p.turning})` : ""}`, p.anniversary && `💍 ${fmtMD(p.anniversary)}`, p.giftIdeas && `🎁 ${p.giftIdeas}`]
                  .filter(Boolean)
                  .join(" · ")}
                badge={
                  soon(p.daysToBirthday) ? (
                    <Pill2 tone={p.daysToBirthday! <= 7 ? "red" : "amber"}>{p.daysToBirthday === 0 ? "Today 🎉" : `🎂 in ${p.daysToBirthday}d`}</Pill2>
                  ) : soon(p.daysToAnniversary) ? (
                    <Pill2 tone="amber">{p.daysToAnniversary === 0 ? "Today 💍" : `💍 in ${p.daysToAnniversary}d`}</Pill2>
                  ) : null
                }
                onOpen={() => setEditing(p)}
                swipeRight={{ label: "Send wishes", icon: <Send className="h-5 w-5" />, className: "bg-pink-500", onTrigger: () => setWishing(p) }}
                swipeLeft={{ label: "Remove", icon: <Trash2 className="h-5 w-5" />, className: "bg-rose-500", onTrigger: () => del(p.id, `${p.name} removed`, `/api/people/${p.id}`) }}
              />
            ))}
          </div>
        </>
      )}
      {wishing && <ShareSheet title={`Wish ${wishing.name}`} text={wishText(wishing)} onClose={() => setWishing(null)} />}
      {editing && <PersonForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Day + month pickers → "MM-DD". */
function MonthDay({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [m, d] = value ? value.split("-") : ["", ""];
  const maxDay = m ? [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(m) - 1] : 31;
  // Picking a shorter month pulls the day back (31 → 30 Apr, 29 Feb).
  const set = (mm: string, dd: string) => {
    const limit = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(mm) - 1] || 31;
    const day = dd && Number(dd) > limit ? String(limit) : dd;
    onChange(mm && day ? `${mm}-${day}` : "");
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      <select className={field} value={d} onChange={(e) => set(m || "01", e.target.value)} aria-label="Day">
        <option value="">Day</option>
        {Array.from({ length: maxDay }, (_, i) => String(i + 1).padStart(2, "0")).map((x) => (
          <option key={x} value={x}>
            {Number(x)}
          </option>
        ))}
      </select>
      <select className={field} value={m} onChange={(e) => set(e.target.value, d || "01")} aria-label="Month">
        <option value="">Month</option>
        {MONTHS.map((x, i) => (
          <option key={x} value={String(i + 1).padStart(2, "0")}>
            {x}
          </option>
        ))}
      </select>
    </div>
  );
}

function PersonForm({ initial, onClose }: { initial: Partial<Person>; onClose: () => void }) {
  const { busy, run } = useSubmit();
  const [v, setV] = useState({
    name: initial.name || "",
    relation: initial.relation || "",
    birthday: initial.birthday || "",
    birthYear: initial.birthYear ? String(initial.birthYear) : "",
    anniversary: initial.anniversary || "",
    giftBudget: initial.giftBudgetPaise ? String(initial.giftBudgetPaise / 100) : "",
    giftIdeas: initial.giftIdeas || "",
    notes: initial.notes || "",
  });
  const save = () =>
    run(
      () =>
        api(initial.id ? `/api/people/${initial.id}` : "/api/people", {
          method: initial.id ? "PATCH" : "POST",
          json: {
            ...v,
            birthday: v.birthday || null,
            anniversary: v.anniversary || null,
            birthYear: v.birthYear ? Number(v.birthYear) : null,
            giftBudget: v.giftBudget ? Number(v.giftBudget) : null,
          },
        }),
      initial.id ? "Saved" : "Added",
      onClose,
    );
  return (
    <Modal title={initial.id ? initial.name || "Edit" : "Add someone"} onClose={onClose}>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Name</label>
            <input className={field} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </div>
          <div>
            <label className={label}>Relation</label>
            <input className={field} placeholder="Mom, friend…" value={v.relation} onChange={(e) => setV({ ...v, relation: e.target.value })} />
          </div>
        </div>
        <div>
          <label className={label}>Birthday</label>
          <MonthDay value={v.birthday} onChange={(x) => setV({ ...v, birthday: x })} />
        </div>
        <div>
          <label className={label}>Birth year (optional, to show the age)</label>
          <input type="number" inputMode="numeric" className={field} value={v.birthYear} onChange={(e) => setV({ ...v, birthYear: e.target.value })} />
        </div>
        <div>
          <label className={label}>Anniversary</label>
          <MonthDay value={v.anniversary} onChange={(x) => setV({ ...v, anniversary: x })} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={label}>Gift budget</label>
            <input type="number" inputMode="decimal" className={field} value={v.giftBudget} onChange={(e) => setV({ ...v, giftBudget: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className={label}>Gift ideas</label>
            <input className={field} placeholder="Books, perfume…" value={v.giftIdeas} onChange={(e) => setV({ ...v, giftIdeas: e.target.value })} />
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          {initial.id && (
            <button className={clsx(ghostBtn, "text-rose-500")} onClick={() => run(() => api(`/api/people/${initial.id}`, { method: "DELETE" }), "Removed", onClose)} aria-label="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button data-submit className={clsx(primaryBtn, "flex-1")} disabled={busy || !v.name} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------- Health

export function HealthScreen() {
  const { data, loading } = useData<{ medicines: Medicine[] }>("/api/medicines");
  const [editing, setEditing] = useState<Partial<Medicine> | null>(null);
  const [refilling, setRefilling] = useState<Medicine | null>(null);
  const agenda = useData<{ items: AgendaItem[] }>("/api/agenda?days=1");
  const now = useNow();
  const hidden = useHidden();
  const del = useUndoDelete();
  const meds = (data?.medicines || []).filter((m) => !hidden.has(m.id));
  const today = todayStr();
  const doses = (agenda.data?.items || []).filter(
    (i) => i.category === "health" && new Date(i.occurrenceAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) === today,
  );
  return (
    <div>
      <Back />
      <PageTitle title="Health" subtitle="Medicines, doses and refills" right={<AddBtn onClick={() => setEditing({ times: ["09:00"], perDose: 1, refillAt: 5 })} text="Medicine" />} />
      {loading ? (
        <SkeletonList rows={2} />
      ) : !meds.length ? (
        <Empty
          icon={<Pill className="h-6 w-6" />}
          title="Dose reminders"
          text="Add a medicine with its times. Tap Done on each reminder and Remindo counts down the tablets and tells you when to refill."
          action={<button data-submit className={primaryBtn} onClick={() => setEditing({ times: ["09:00"], perDose: 1, refillAt: 5 })}>Add medicine</button>}
        />
      ) : (
        <>
          {doses.length > 0 && (
            <Section title={`Today's doses · ${doses.filter((d) => d.done).length}/${doses.length} taken`}>
              <div className="grid gap-2">
                {doses.map((i) => (
                  <ReminderItem key={`${i.reminderId}-${i.occurrenceAt}`} i={i} now={now} />
                ))}
              </div>
            </Section>
          )}
          <Section title="Medicines">
            <SwipeHint text="Tip: tick a dose when you take it. Swipe a medicine right to refill, left to remove it." />
            <div className="grid gap-2">
              {meds.map((m) => {
                const days = m.stock !== null && m.times.length ? Math.floor(m.stock / (m.perDose * m.times.length)) : null;
                return (
                  <ItemRow
                    key={m.id}
                    icon={rowIcon("bg-emerald-500/15 text-emerald-500", <Pill className="h-5 w-5" />)}
                    title={m.name}
                    sub={[m.dose, m.times.map((t) => to12(t)).join(", ")].filter(Boolean).join(" · ")}
                    badge={
                      m.stock !== null && (
                        <Pill2 tone={m.stock <= m.refillAt ? "red" : "muted"}>
                          {m.stock} left{days !== null ? ` · ${days}d` : ""}
                        </Pill2>
                      )
                    }
                    actions={
                      <button onClick={() => setRefilling(m)} className="rounded-lg px-2 py-1 text-xs font-medium text-indigo-500 hover:bg-raised">
                        Refill
                      </button>
                    }
                    onOpen={() => setEditing(m)}
                    swipeRight={{ label: "Refill", icon: <Plus className="h-5 w-5" />, className: "bg-emerald-500", onTrigger: () => setRefilling(m) }}
                    swipeLeft={{ label: "Remove", icon: <Trash2 className="h-5 w-5" />, className: "bg-rose-500", onTrigger: () => del(m.id, `${m.name} removed`, `/api/medicines/${m.id}`) }}
                  />
                );
              })}
            </div>
          </Section>
        </>
      )}
      <p className="mt-4 px-1 text-xs text-muted">Reminders only. Follow your doctor&apos;s advice for doses.</p>
      {editing && <MedicineForm initial={editing} onClose={() => setEditing(null)} />}
      {refilling && <RefillForm med={refilling} onClose={() => setRefilling(null)} />}
    </div>
  );
}

function to12(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

function MedicineForm({ initial, onClose }: { initial: Partial<Medicine>; onClose: () => void }) {
  const { busy, run } = useSubmit();
  const [v, setV] = useState({
    name: initial.name || "",
    dose: initial.dose || "",
    times: initial.times?.length ? initial.times : ["09:00"],
    stock: initial.stock !== null && initial.stock !== undefined ? String(initial.stock) : "",
    perDose: String(initial.perDose || 1),
    refillAt: String(initial.refillAt ?? 5),
  });
  const save = () =>
    run(
      () =>
        api(initial.id ? `/api/medicines/${initial.id}` : "/api/medicines", {
          method: initial.id ? "PATCH" : "POST",
          json: { ...v, stock: v.stock === "" ? null : Number(v.stock), perDose: Number(v.perDose) || 1, refillAt: Number(v.refillAt) || 0 },
        }),
      initial.id ? "Saved" : "Added. Dose reminders are set",
      onClose,
    );
  return (
    <Modal title={initial.id ? "Edit medicine" : "New medicine"} onClose={onClose}>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Name</label>
            <input className={field} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </div>
          <div>
            <label className={label}>Dose</label>
            <input className={field} placeholder="1 tablet, 5 ml…" value={v.dose} onChange={(e) => setV({ ...v, dose: e.target.value })} />
          </div>
        </div>
        <div>
          <label className={label}>Times</label>
          <div className="flex flex-wrap gap-2">
            {v.times.map((t, i) => (
              <div key={i} className="flex items-center gap-1">
                <input type="time" className={clsx(field, "w-32")} value={t} onChange={(e) => setV({ ...v, times: v.times.map((x, j) => (j === i ? e.target.value : x)) })} />
                {v.times.length > 1 && (
                  <button className="p-1 text-subtle hover:text-rose-500" onClick={() => setV({ ...v, times: v.times.filter((_, j) => j !== i) })} aria-label="Remove time">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            {v.times.length < 6 && (
              <button className={ghostBtn} onClick={() => setV({ ...v, times: [...v.times, v.times.length === 1 ? "21:00" : "14:00"] })}>
                + Time
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={label}>In stock</label>
            <input type="number" inputMode="numeric" className={field} value={v.stock} onChange={(e) => setV({ ...v, stock: e.target.value })} />
          </div>
          <div>
            <label className={label}>Per dose</label>
            <input type="number" inputMode="numeric" className={field} value={v.perDose} onChange={(e) => setV({ ...v, perDose: e.target.value })} />
          </div>
          <div>
            <label className={label}>Alert at</label>
            <input type="number" inputMode="numeric" className={field} value={v.refillAt} onChange={(e) => setV({ ...v, refillAt: e.target.value })} />
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          {initial.id && (
            <button className={clsx(ghostBtn, "text-rose-500")} onClick={() => run(() => api(`/api/medicines/${initial.id}`, { method: "DELETE" }), "Removed", onClose)} aria-label="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button data-submit className={clsx(primaryBtn, "flex-1")} disabled={busy || !v.name || !v.times.length} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RefillForm({ med, onClose }: { med: Medicine; onClose: () => void }) {
  const { busy, run } = useSubmit();
  const [n, setN] = useState("10");
  return (
    <Modal title={`Refill ${med.name}`} onClose={onClose}>
      <div className="grid gap-3">
        <div>
          <label className={label}>How many did you buy?</label>
          <input type="number" inputMode="numeric" className={field} value={n} onChange={(e) => setN(e.target.value)} />
        </div>
        <button data-submit className={primaryBtn} disabled={busy || !Number(n)} onClick={() => run(() => api(`/api/medicines/${med.id}`, { method: "POST", json: { added: Number(n) } }), "Stock updated", onClose)}>
          <Check className="h-4 w-4" /> Save
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------- Study

export function StudyScreen() {
  const { data, loading } = useData<{ reminders: StudyItem[] }>("/api/reminders?category=study");
  const [open, setOpen] = useState(false);
  const hidden = useHidden();
  const del = useUndoDelete();
  const ra = useReminderActions();
  const { toast } = useToast();
  const items = (data?.reminders || []).filter((r) => r.status === "active" && !hidden.has(r.id)).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const occ = (r: StudyItem, action: "done" | "undo") => api("/api/occurrence", { method: "POST", json: { reminderId: r.id, occurrenceAt: r.dueAt, action } });
  const finish = async (r: StudyItem) => {
    await occ(r, "done");
    refreshAll();
    toast({ message: `“${r.title}” finished 🎉`, action: { label: "Undo", onClick: () => occ(r, "undo").then(refreshAll) } });
  };
  return (
    <div>
      <Back />
      <PageTitle title="Study" subtitle="Exams, assignments and deadlines" right={<AddBtn onClick={() => setOpen(true)} text="Deadline" />} />
      {loading ? (
        <SkeletonList rows={2} />
      ) : !items.length ? (
        <Empty
          icon={<BookOpen className="h-6 w-6" />}
          title="Stay ahead of deadlines"
          text="Add exams and assignments. You'll be reminded a week before, a day before and 3 hours before."
          action={<button data-submit className={primaryBtn} onClick={() => setOpen(true)}>Add a deadline</button>}
        />
      ) : (
        <>
          <SwipeHint text="Tip: tick it or swipe right when it's finished, swipe left to delete." />
          <div className="grid gap-2">
            {items.map((r) => {
              const date = r.input?.date || new Date(r.dueAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
              const left = date ? daysTo(date) : null;
              return (
                <ItemRow
                  key={r.id}
                  check={{ done: false, onToggle: () => finish(r), label: "Finished" }}
                  title={r.title}
                  sub={[date && relativeDay(date), r.notes].filter(Boolean).join(" · ")}
                  badge={left !== null && <Pill2 tone={left <= 1 ? "red" : left <= 7 ? "amber" : "muted"}>{left < 0 ? `${-left}d late` : left === 0 ? "Today" : `${left}d`}</Pill2>}
                  onOpen={() => ra.edit(r.id)}
                  swipeRight={{ label: "Finished", icon: <Check className="h-5 w-5" />, className: "bg-emerald-500", onTrigger: () => finish(r) }}
                  swipeLeft={{ label: "Delete", icon: <Trash2 className="h-5 w-5" />, className: "bg-rose-500", onTrigger: () => del(r.id, `“${r.title}” deleted`, `/api/reminders/${r.id}`) }}
                />
              );
            })}
          </div>
        </>
      )}
      {open && <StudyForm onClose={() => setOpen(false)} />}
    </div>
  );
}

function StudyForm({ onClose }: { onClose: () => void }) {
  const { busy, run } = useSubmit();
  const [kind, setKind] = useState<"Exam" | "Assignment" | "Quiz" | "Project">("Exam");
  const [v, setV] = useState({ subject: "", date: "", time: "10:00", notes: "" });
  const save = () =>
    run(
      () =>
        api("/api/reminders", {
          method: "POST",
          json: {
            items: [
              {
                title: `${kind === "Assignment" || kind === "Project" ? "Submit" : ""} ${v.subject} ${kind.toLowerCase()}`.trim().replace(/^\w/, (c) => c.toUpperCase()),
                notes: v.notes || null,
                date: v.date,
                time: v.time || null,
                recurrence: "none",
                interval: 1,
                priority: "high",
                category: "study",
                leadTimes: [10080, 1440, 180],
              },
            ],
          },
        }),
      "Added. You'll be reminded a week, a day and 3 hours before",
      onClose,
    );
  return (
    <Modal title="New deadline" onClose={onClose}>
      <div className="grid gap-3">
        <div className="flex rounded-xl bg-raised p-1">
          {(["Exam", "Assignment", "Quiz", "Project"] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={clsx("flex-1 rounded-lg py-2 text-sm font-medium", kind === k ? "bg-surface shadow-sm ring-1 ring-line" : "text-muted")}>
              {k}
            </button>
          ))}
        </div>
        <div>
          <label className={label}>Subject</label>
          <input className={field} placeholder="e.g. Statistics II" value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Date</label>
            <input type="date" className={field} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
          </div>
          <div>
            <label className={label}>Time</label>
            <input type="time" className={field} value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} />
          </div>
        </div>
        <div>
          <label className={label}>Notes</label>
          <input className={field} placeholder="Syllabus, venue…" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </div>
        <button data-submit className={primaryBtn} disabled={busy || !v.subject || !v.date} onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------- Notes & lists

export function ListsScreen() {
  const { data, loading } = useData<{ lists: ListSummary[] }>("/api/lists");
  const [creating, setCreating] = useState<"list" | "note" | null>(null);
  const router = useRouter();
  const { toast } = useToast();
  const hidden = useHidden();
  const del = useUndoDelete();
  const all = (data?.lists || []).filter((l) => !hidden.has(l.id));
  return (
    <div>
      <Back />
      <PageTitle
        title="Notes & lists"
        right={
          <div className="flex gap-2">
            <AddBtn onClick={() => setCreating("note")} text="Note" />
            <AddBtn onClick={() => setCreating("list")} text="List" />
          </div>
        }
      />
      {loading ? (
        <SkeletonList rows={3} />
      ) : !all.length ? (
        <Empty
          icon={<ListChecks className="h-6 w-6" />}
          title="Lists and quick notes"
          text={`Make a shopping or packing list, or just say "add eggs and bread to my shopping list".`}
          action={<button data-submit className={primaryBtn} onClick={() => setCreating("list")}>New list</button>}
        />
      ) : (
        <>
          <SwipeHint text="Tip: swipe a list right to pin it to the top, left to delete it." />
          <div className="grid gap-2">
            {all.map((l) => (
              <ItemRow
                key={l.id}
                icon={rowIcon("bg-teal-500/15 text-xl", l.emoji || (l.kind === "note" ? "🗒️" : "📝"))}
                title={
                  <>
                    {l.name}
                    {l.pinned && <Pin className="ml-1.5 inline h-3 w-3 text-subtle" />}
                  </>
                }
                sub={l.kind === "list" ? (l.total ? `${l.open} left · ${l.total - l.open} done` : "Empty list") : l.body?.slice(0, 80) || "Empty note"}
                badge={
                  l.kind === "list" && l.total > 0 ? (
                    <span className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-raised">
                      <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(((l.total - l.open) / l.total) * 100)}%` }} />
                    </span>
                  ) : null
                }
                onOpen={() => router.push(`/lists?id=${l.id}`)}
                swipeRight={{
                  label: l.pinned ? "Unpin" : "Pin",
                  icon: l.pinned ? <PinOff className="h-5 w-5" /> : <Pin className="h-5 w-5" />,
                  className: "bg-indigo-500",
                  onTrigger: () =>
                    api(`/api/lists/${l.id}`, { method: "PATCH", json: { pinned: !l.pinned } }).then(() => {
                      refreshAll();
                      toast({ message: l.pinned ? `Unpinned ${l.name}` : `Pinned ${l.name} to the top` });
                    }),
                }}
                swipeLeft={{ label: "Delete", icon: <Trash2 className="h-5 w-5" />, className: "bg-rose-500", onTrigger: () => del(l.id, `“${l.name}” deleted`, `/api/lists/${l.id}`) }}
              />
            ))}
          </div>
        </>
      )}
      {creating && <NewListForm kind={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}

function NewListForm({ kind, onClose }: { kind: "list" | "note"; onClose: () => void }) {
  const { busy, run } = useSubmit();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(kind === "list" ? "🛒" : "🗒️");
  const EMOJIS = kind === "list" ? ["🛒", "🧳", "🎁", "📚", "🎬", "💡", "✅", "📝"] : ["🗒️", "💡", "🔑", "📌", "✍️", "🍳"];
  return (
    <Modal title={kind === "list" ? "New list" : "New note"} onClose={onClose}>
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-1.5">
          {EMOJIS.map((e) => (
            <button key={e} onClick={() => setEmoji(e)} className={clsx("grid h-10 w-10 place-items-center rounded-xl text-xl", emoji === e ? "bg-raised ring-2 ring-indigo-400" : "hover:bg-raised")}>
              {e}
            </button>
          ))}
        </div>
        <input
          className={field}
          autoFocus
          maxLength={60}
          placeholder={kind === "list" ? "Shopping, Packing for Goa…" : "Title"}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button data-submit className={primaryBtn} disabled={busy || !name.trim()} onClick={() => create()}>
          Create
        </button>
      </div>
    </Modal>
  );
  function create() {
    return run(
      async () => {
        const r = await api<{ list: { id: string } }>("/api/lists", { method: "POST", json: { name, emoji, kind } });
        window.location.href = `/lists?id=${r.list.id}`;
      },
      "Created",
    );
  }
}

/** /lists shows all lists; /lists?id=… opens one. */
export function ListsRoute() {
  const id = useSearchParams().get("id");
  return id ? <ListDetailScreen key={id} id={id} /> : <ListsScreen />;
}

export function ListDetailScreen({ id }: { id: string }) {
  const { data, loading, reload } = useData<{ list: ListFull }>(`/api/lists/${id}`);
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [body, setBody] = useState<string | null>(null);
  const l = data?.list;

  const add = async () => {
    const items = text.split(/\n|,/).map((x) => x.trim()).filter(Boolean);
    if (!items.length) return;
    setText("");
    await api(`/api/lists/${id}/items`, { method: "POST", json: { items } }).catch((e) => toast({ message: e.message, tone: "error" }));
    reload();
  };
  const hidden = useHidden();
  const del = useUndoDelete();
  // Tick instantly; the server catches up.
  const [flip, setFlip] = useState<Record<string, boolean>>({});
  const toggle = async (it: ListItem) => {
    setFlip((f) => ({ ...f, [it.id]: !it.done }));
    await api(`/api/list-items/${it.id}`, { method: "PATCH", json: { done: !it.done } });
    await reload();
    setFlip((f) => {
      const n = { ...f };
      delete n[it.id];
      return n;
    });
  };
  const remove = (it: ListItem) => del(it.id, `“${it.text}” removed`, `/api/list-items/${it.id}`, reload);
  const saveBody = async () => {
    if (body === null) return;
    await api(`/api/lists/${id}`, { method: "PATCH", json: { body } });
    toast({ message: "Saved" });
    reload();
  };

  if (loading || !l) {
    return (
      <div>
        <Back href="/lists" text="Notes & lists" />
        <SkeletonList rows={4} />
      </div>
    );
  }
  const items = l.items.filter((i) => !hidden.has(i.id)).map((i) => (i.id in flip ? { ...i, done: flip[i.id] } : i));
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  return (
    <div>
      <Back href="/lists" text="Notes & lists" />
      <PageTitle
        title={`${l.emoji || ""} ${l.name}`.trim()}
        right={
          <div className="flex gap-1">
            <ShareButton
              text={listShareText({ ...l, body: body ?? l.body })}
              title={`Share ${l.name}`}
              label=""
              className="grid h-10 w-10 place-items-center rounded-xl text-subtle hover:bg-raised hover:text-indigo-500"
            />
            <button
              onClick={() => api(`/api/lists/${id}`, { method: "PATCH", json: { pinned: !l.pinned } }).then(reload)}
              className={clsx("grid h-10 w-10 place-items-center rounded-xl hover:bg-raised", l.pinned ? "text-indigo-500" : "text-subtle")}
              aria-label={l.pinned ? "Unpin" : "Pin"}
            >
              <Pin className="h-4 w-4" />
            </button>
            <button
              onClick={async () => {
                await api(`/api/lists/${id}`, { method: "DELETE" });
                toast({ message: "Deleted" });
                window.location.href = "/lists";
              }}
              className="grid h-10 w-10 place-items-center rounded-xl text-subtle hover:bg-raised hover:text-rose-500"
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        }
      />
      {l.kind === "note" ? (
        <div className="card rounded-3xl p-4">
          <textarea
            className="min-h-[50vh] w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none"
            placeholder="Write anything…"
            value={body ?? l.body ?? ""}
            onChange={(e) => setBody(e.target.value)}
            onBlur={saveBody}
          />
        </div>
      ) : (
        <>
          <div className="mb-4 flex gap-2">
            <input
              className={clsx(field, "flex-1")}
              placeholder="Add items (comma separated)"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
            <button data-submit className={primaryBtn} onClick={add} aria-label="Add">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {!l.items.length ? (
            <p className="px-1 text-sm text-muted">Nothing here yet.</p>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-3 px-1 text-xs text-muted">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
                  <span className="block h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.round((done.length / Math.max(1, items.length)) * 100)}%` }} />
                </span>
                {done.length}/{items.length} done
              </div>
              <div className="grid gap-2">
                {[...open, ...done].map((it) => (
                  <ItemRow
                    key={it.id}
                    check={{ done: it.done, onToggle: () => toggle(it), label: it.done ? "Untick" : "Tick", square: true }}
                    title={it.text}
                    done={it.done}
                    swipeRight={{ label: it.done ? "Untick" : "Tick", icon: <Check className="h-5 w-5" />, className: "bg-emerald-500", onTrigger: () => toggle(it) }}
                    swipeLeft={{ label: "Remove", icon: <Trash2 className="h-5 w-5" />, className: "bg-rose-500", onTrigger: () => remove(it) }}
                    actions={
                      <button onClick={() => remove(it)} className="hidden p-1.5 text-subtle hover:text-rose-500 sm:block" aria-label="Remove">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    }
                  />
                ))}
              </div>
            </>
          )}
          {done.length > 0 && (
            <button className="mt-3 px-1 text-sm text-muted hover:text-fg" onClick={() => api(`/api/lists/${id}/items`, { method: "DELETE" }).then(reload)}>
              Clear {done.length} ticked
            </button>
          )}
        </>
      )}
    </div>
  );
}
