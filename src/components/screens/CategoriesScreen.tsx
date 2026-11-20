"use client";

import Link from "next/link";
import { useState } from "react";
import { clsx } from "clsx";
import { ArrowLeft, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import { api, refreshAll, useCategories } from "@/components/app/client";
import { PageTitle, Section, SkeletonList } from "@/components/app/rows";
import { useToast } from "@/components/app/toast";
import { field, label } from "@/components/app/ReminderEditor";
import { Modal, ghostBtn, primaryBtn } from "@/components/screens/MoneyPlus";
import { categoryMeta, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/components/types";

const EMOJIS = ["🏷️", "🐶", "🏋️", "☕", "🍺", "💇", "🧒", "🚗", "🏍️", "📱", "💡", "🎮", "⚽", "🙏", "🧹", "🪴", "💄", "🎓", "🏥", "💰", "🎨", "🧘", "🍰", "🛠️"];
const LOCKED = new Set(["Other", "Refund"]);

type Editing = { from?: string; name: string; emoji: string; type: "expense" | "income" };

export function CategoriesScreen() {
  const { data, loading } = useCategories();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [tab, setTab] = useState<"expense" | "income">("expense");

  const call = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast({ message: msg });
      refreshAll();
    } catch (e) {
      toast({ message: (e as Error).message, tone: "error" });
    }
  };

  const builtIn = (tab === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).filter((c) => !LOCKED.has(c));
  const mine = (data?.custom || []).filter((c) => c.type === tab);
  const hidden = new Set(data?.hidden || []);

  return (
    <div>
      <Link href="/more" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> More
      </Link>
      <PageTitle
        title="Categories"
        subtitle="Add your own, rename them, hide ones you never use"
        right={
          <button onClick={() => setEditing({ name: "", emoji: "🏷️", type: tab })} className={clsx(ghostBtn, "flex items-center gap-1.5")}>
            <Plus className="h-4 w-4" /> New
          </button>
        }
      />
      <div className="mb-5 flex rounded-xl bg-raised p-1">
        {(["expense", "income"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx("flex-1 rounded-lg py-2 text-sm font-medium capitalize", tab === t ? "bg-surface shadow-sm ring-1 ring-line" : "text-muted")}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonList rows={4} />
      ) : (
        <>
          <Section title="Yours">
            {mine.length ? (
              <div className="card divide-y divide-line overflow-hidden rounded-2xl">
                {mine.map((c) => (
                  <div key={c.name} className="flex items-center gap-3 px-4 py-3">
                    <span className="text-lg">{c.emoji}</span>
                    <span className="flex-1 font-medium">{c.name}</span>
                    <button onClick={() => setEditing({ from: c.name, name: c.name, emoji: c.emoji, type: c.type })} className="rounded-lg p-2 text-subtle hover:text-fg" aria-label={`Edit ${c.name}`}>
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <button
                onClick={() => setEditing({ name: "", emoji: "🏷️", type: tab })}
                className="card w-full rounded-2xl px-4 py-5 text-center text-sm text-muted hover:bg-raised"
              >
                No categories of your own yet. <span className="text-indigo-500">Add one</span>
              </button>
            )}
          </Section>

          <Section title="Built-in">
            <div className="card divide-y divide-line overflow-hidden rounded-2xl">
              {builtIn.map((c) => {
                const off = hidden.has(c);
                return (
                  <div key={c} className={clsx("flex items-center gap-3 px-4 py-3", off && "opacity-50")}>
                    <span className="text-lg">{categoryMeta(c).emoji}</span>
                    <span className="flex-1 font-medium">{c}</span>
                    {off && <span className="text-xs text-muted">Hidden</span>}
                    <button
                      onClick={() => call(() => api("/api/categories", { method: "PATCH", json: { name: c, hidden: !off } }), off ? `${c} shown` : `${c} hidden`)}
                      className="rounded-lg p-2 text-subtle hover:text-fg"
                      aria-label={off ? `Show ${c}` : `Hide ${c}`}
                    >
                      {off ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 px-1 text-xs text-muted">Hidden categories disappear from the picker. Old entries keep them.</p>
          </Section>
        </>
      )}

      {editing && <CategoryForm initial={editing} onClose={() => setEditing(null)} call={call} />}
    </div>
  );
}

function CategoryForm({ initial, onClose, call }: { initial: Editing; onClose: () => void; call: (fn: () => Promise<unknown>, msg: string) => Promise<void> }) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    await call(fn, msg);
    setBusy(false);
    onClose();
  };
  const save = () =>
    initial.from
      ? run(() => api("/api/categories", { method: "PATCH", json: { from: initial.from, name: v.name, emoji: v.emoji } }), "Saved")
      : run(() => api("/api/categories", { method: "POST", json: { name: v.name, emoji: v.emoji, type: v.type } }), `Added ${v.emoji} ${v.name}`);
  return (
    <Modal title={initial.from ? `Edit ${initial.from}` : "New category"} onClose={onClose}>
      <div className="grid gap-3">
        {!initial.from && (
          <div className="flex rounded-xl bg-raised p-1">
            {(["expense", "income"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setV({ ...v, type: t })}
                className={clsx("flex-1 rounded-lg py-2 text-sm font-medium capitalize", v.type === t ? "bg-surface shadow-sm ring-1 ring-line" : "text-muted")}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        <div>
          <label className={label}>Emoji</label>
          <div className="flex flex-wrap gap-1">
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setV({ ...v, emoji: e })}
                className={clsx("grid h-9 w-9 place-items-center rounded-lg text-lg", v.emoji === e ? "bg-raised ring-2 ring-indigo-400" : "hover:bg-raised")}
                aria-label={`Emoji ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={label}>Name</label>
          <input autoFocus className={field} maxLength={30} placeholder="e.g. Pet care" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          {initial.from && v.name.trim() && v.name.trim() !== initial.from && (
            <p className="mt-1.5 text-xs text-muted">Past entries, budgets and favourites in “{initial.from}” will move to the new name.</p>
          )}
        </div>
        <div className="flex gap-2 pt-1">
          {initial.from && (
            <button
              className={clsx(ghostBtn, "text-rose-500")}
              disabled={busy}
              onClick={() => run(() => api(`/api/categories?name=${encodeURIComponent(initial.from!)}`, { method: "DELETE" }), `Deleted. Its entries are now in Other`)}
              aria-label="Delete category"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button className={clsx(primaryBtn, "flex-1")} disabled={busy || !v.name.trim()} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
