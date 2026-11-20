"use client";

import Link from "next/link";
import { useState } from "react";
import { clsx } from "clsx";
import { ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react";
import { api, useData } from "./client";
import { Section } from "./rows";
import { useToast } from "./toast";
import { Modal, primaryBtn } from "@/components/screens/MoneyPlus";

export const WIDGETS = [
  { id: "summary", label: "Today & money", desc: "Counts, spent today, month vs budget" },
  { id: "overdue", label: "Overdue alert", desc: "Shows only when something is overdue" },
  { id: "favourites", label: "Quick add", desc: "One-tap favourite expenses" },
  { id: "suggestions", label: "Suggestions", desc: "Bills Remindo noticed you pay every month" },
  { id: "focus", label: "Today's focus", desc: "Your tasks for today" },
  { id: "next", label: "Next up", desc: "Reminders for today" },
  { id: "life", label: "Coming up", desc: "Renewals, birthdays, medicine refills" },
  { id: "important", label: "Important dates", desc: "High-priority reminders ahead" },
  { id: "spending", label: "Recent spending", desc: "Last 5 entries" },
] as const;
export type WidgetId = (typeof WIDGETS)[number]["id"];
type Layout = { id: string; hidden: boolean }[];

const DEFAULT: Layout = WIDGETS.map((w) => ({ id: w.id, hidden: false }));

/** Saved order + visibility, with any widgets added later appended at the end. */
export function mergeLayout(saved: Layout | null): Layout {
  if (!saved) return DEFAULT;
  const known = new Set<string>(WIDGETS.map((w) => w.id));
  const kept = saved.filter((w) => known.has(w.id));
  const missing = DEFAULT.filter((d) => !kept.some((k) => k.id === d.id));
  return [...kept, ...missing];
}

export function useHomeLayout() {
  const { data, setData } = useData<{ widgets: Layout | null }>("/api/home-layout");
  const layout = mergeLayout(data?.widgets ?? null);
  const saveLayout = async (next: Layout) => {
    setData({ widgets: next });
    await api("/api/home-layout", { method: "PUT", json: { widgets: next } });
  };
  return { layout, saveLayout };
}

export function CustomiseHome({ layout, onClose, onSave }: { layout: Layout; onClose: () => void; onSave: (l: Layout) => Promise<void> }) {
  const { toast } = useToast();
  const [items, setItems] = useState(layout);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };
  return (
    <Modal title="Customise Home" onClose={onClose}>
      <p className="mb-3 text-sm text-muted">Reorder or hide what you see on Home.</p>
      <div className="card divide-y divide-line overflow-hidden rounded-2xl">
        {items.map((w, i) => {
          const meta = WIDGETS.find((x) => x.id === w.id)!;
          return (
            <div key={w.id} className={clsx("flex items-center gap-2 px-3 py-2.5", w.hidden && "opacity-50")}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{meta.label}</p>
                <p className="truncate text-xs text-muted">{meta.desc}</p>
              </div>
              <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded-lg p-1.5 text-subtle hover:bg-raised disabled:opacity-30" aria-label="Move up">
                <ChevronUp className="h-4 w-4" />
              </button>
              <button onClick={() => move(i, 1)} disabled={i === items.length - 1} className="rounded-lg p-1.5 text-subtle hover:bg-raised disabled:opacity-30" aria-label="Move down">
                <ChevronDown className="h-4 w-4" />
              </button>
              <button
                onClick={() => setItems(items.map((x, j) => (j === i ? { ...x, hidden: !x.hidden } : x)))}
                className="rounded-lg p-1.5 text-subtle hover:bg-raised"
                aria-label={w.hidden ? `Show ${meta.label}` : `Hide ${meta.label}`}
              >
                {w.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex gap-2">
        <button className="rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-raised" onClick={() => setItems(DEFAULT)}>
          Reset
        </button>
        <button data-submit
          className={clsx(primaryBtn, "flex-1")}
          onClick={() =>
            onSave(items)
              .then(() => {
                toast({ message: "Home updated" });
                onClose();
              })
              .catch((e) => toast({ message: (e as Error).message, tone: "error" }))
          }
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

type Doc = { id: string; name: string; expiryDate: string };
type Person = { id: string; name: string; daysToBirthday: number | null; daysToAnniversary: number | null; turning: number | null };
type Med = { id: string; name: string; stock: number | null; refillAt: number };

const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const daysTo = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${todayStr()}T00:00:00Z`)) / 86400000);
const when = (n: number) => (n < 0 ? `${-n}d overdue` : n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);

/** Renewals in 30 days, birthdays/anniversaries in 14, medicines running low. Hidden when empty. */
export function ComingUp() {
  const docs = useData<{ documents: Doc[] }>("/api/documents");
  const ppl = useData<{ people: Person[] }>("/api/people");
  const meds = useData<{ medicines: Med[] }>("/api/medicines");
  const rows: { key: string; icon: string; text: string; sub: string; href: string; n: number }[] = [];
  for (const d of docs.data?.documents || []) {
    const n = daysTo(d.expiryDate);
    if (n <= 30) rows.push({ key: d.id, icon: "📄", text: `${d.name} expires`, sub: when(n), href: "/life/documents", n });
  }
  for (const p of ppl.data?.people || []) {
    if (p.daysToBirthday !== null && p.daysToBirthday <= 14)
      rows.push({ key: p.id + "b", icon: "🎂", text: `${p.name}'s birthday${p.turning ? ` (${p.turning})` : ""}`, sub: when(p.daysToBirthday), href: "/life/people", n: p.daysToBirthday });
    if (p.daysToAnniversary !== null && p.daysToAnniversary <= 14)
      rows.push({ key: p.id + "a", icon: "💍", text: `${p.name} anniversary`, sub: when(p.daysToAnniversary), href: "/life/people", n: p.daysToAnniversary });
  }
  for (const m of meds.data?.medicines || []) {
    if (m.stock !== null && m.stock <= m.refillAt) rows.push({ key: m.id, icon: "💊", text: `Refill ${m.name}`, sub: `${m.stock} left`, href: "/life/health", n: 0 });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => a.n - b.n);
  return (
    <Section title="Coming up">
      <div className="card divide-y divide-line overflow-hidden rounded-2xl">
        {rows.slice(0, 5).map((r) => (
          <Link key={r.key} href={r.href} className="flex items-center gap-3 px-4 py-3 hover:bg-raised">
            <span className="text-lg">{r.icon}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.text}</span>
            <span className={clsx("shrink-0 text-xs", r.n <= 7 ? "font-medium text-rose-500" : "text-muted")}>{r.sub}</span>
          </Link>
        ))}
      </div>
    </Section>
  );
}
