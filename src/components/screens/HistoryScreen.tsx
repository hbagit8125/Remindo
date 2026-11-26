"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { BellOff, Check, CheckCheck, Clock, HandCoins, History, Loader2, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { relativeDay, undoChanges, useData } from "@/components/app/client";
import { Empty, PageTitle, Section, SkeletonList } from "@/components/app/rows";
import { Back } from "@/components/screens/LifeScreens";
import { useToast } from "@/components/app/toast";

type Item = { id: string; title: string; kind: string; via: string; createdAt: string; undoneAt: string | null };

const KIND: Record<string, { icon: React.ReactNode; tint: string }> = {
  done: { icon: <Check className="h-4 w-4" />, tint: "bg-emerald-500/15 text-emerald-500" },
  tick: { icon: <CheckCheck className="h-4 w-4" />, tint: "bg-emerald-500/15 text-emerald-500" },
  snooze: { icon: <Clock className="h-4 w-4" />, tint: "bg-amber-500/15 text-amber-500" },
  settle: { icon: <HandCoins className="h-4 w-4" />, tint: "bg-teal-500/15 text-teal-500" },
  add: { icon: <Plus className="h-4 w-4" />, tint: "bg-indigo-500/15 text-indigo-500" },
  edit: { icon: <Pencil className="h-4 w-4" />, tint: "bg-sky-500/15 text-sky-500" },
  delete: { icon: <Trash2 className="h-4 w-4" />, tint: "bg-rose-500/15 text-rose-500" },
};
const VIA: Record<string, string> = { telegram: "Telegram", email: "email", push: "notification", app: "" };

const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });

export function HistoryScreen() {
  const { data, loading, reload } = useData<{ items: Item[]; days: number; ready: boolean }>("/api/activity");
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const items = data?.items || [];

  const undo = async (it: Item) => {
    setBusy(it.id);
    try {
      const r = await undoChanges([it.id]);
      toast({ message: r.ok ? `↩️ ${r.message}` : r.message, tone: r.ok ? "ok" : "error" });
    } catch (e) {
      toast({ message: (e as Error).message, tone: "error" });
    } finally {
      setBusy(null);
      reload();
    }
  };

  // Group by day, newest first.
  const groups: [string, Item[]][] = [];
  for (const it of items) {
    const d = dayOf(it.createdAt);
    const g = groups.find(([k]) => k === d);
    if (g) g[1].push(it);
    else groups.push([d, [it]]);
  }

  return (
    <div>
      <Back />
      <PageTitle title="History" subtitle={`Everything you changed in the last ${data?.days || 30} days, from the app, Telegram, email or notifications`} />
      <p className="mb-4 rounded-2xl bg-indigo-500/10 px-4 py-3 text-sm text-indigo-800 dark:text-indigo-200">
        Did something by mistake? Tap <b>Undo</b> and it goes back exactly as it was. Quick ways: the <b>Undo</b> button on the message that pops up, <b>Ctrl+Z</b> on a laptop, or <b>/undo</b> in Telegram.
      </p>
      {loading ? (
        <SkeletonList rows={6} />
      ) : data && !data.ready ? (
        <Empty icon={<BellOff className="h-6 w-6" />} title="History isn't set up yet" text="Run the latest database update (migration 0008) to start keeping history." />
      ) : !items.length ? (
        <Empty icon={<History className="h-6 w-6" />} title="Nothing yet" text="Changes you make will show up here, with an Undo button." />
      ) : (
        groups.map(([d, list]) => (
          <Section key={d} title={relativeDay(d)}>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
              {list.map((it) => {
                const k = KIND[it.kind] || KIND.edit;
                const via = VIA[it.via];
                return (
                  <div key={it.id} className={clsx("card flex items-center gap-3 rounded-2xl px-3.5 py-3", it.undoneAt && "opacity-55")}>
                    <span className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-xl", k.tint)}>{k.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className={clsx("truncate font-medium", it.undoneAt && "line-through")}>{it.title}</p>
                      <p className="text-xs text-muted">
                        {timeOf(it.createdAt)}
                        {via ? ` · from ${via}` : ""}
                        {it.undoneAt ? " · undone" : ""}
                      </p>
                    </div>
                    {!it.undoneAt && (
                      <button
                        onClick={() => undo(it)}
                        disabled={busy === it.id}
                        className="flex shrink-0 items-center gap-1 rounded-xl border border-line px-3 py-1.5 text-xs font-semibold hover:bg-raised disabled:opacity-50"
                      >
                        {busy === it.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Undo
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        ))
      )}
    </div>
  );
}
