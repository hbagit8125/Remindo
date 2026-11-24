"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Check, ChevronDown, Plus, Split, Users, X } from "lucide-react";
import { useData } from "./client";
import { computeShares, ME, type Method } from "@/lib/split-math";

export type SplitValue = { paidBy: string; method: Method; people: { person: string; value: number }[] };

export type SplitsData = {
  known: string[];
  groups: { id: string; name: string; members: string[] }[];
};

const COLORS = ["bg-emerald-500", "bg-pink-500", "bg-amber-500", "bg-sky-500", "bg-violet-500", "bg-rose-500", "bg-teal-500", "bg-orange-500"];
export function personColor(name: string) {
  if (name === ME) return "bg-indigo-500";
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
export const displayName = (p: string) => (p === ME ? "You" : p);

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span className={clsx("grid shrink-0 place-items-center rounded-full font-semibold text-white", personColor(name))} style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {displayName(name)[0]?.toUpperCase()}
    </span>
  );
}

export const blankSplit = (): SplitValue => ({ paidBy: ME, method: "equal", people: [{ person: ME, value: 0 }] });

/** Each person's share for the current inputs, or the reason it doesn't add up yet. */
export function previewSplit(totalRupees: number, v: SplitValue) {
  const total = Math.round((totalRupees || 0) * 100);
  if (!total) return { error: "Enter the bill amount", shares: null as null | { person: string; sharePaise: number }[] };
  if (v.people.length < 2) return { error: "Add someone to split with", shares: null };
  try {
    const shares = computeShares(total, v.method, v.people);
    return { error: null, shares };
  } catch (e) {
    return { error: (e as Error).message, shares: null };
  }
}

const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const lbl = "mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted";

/**
 * The "Split this bill" box: who paid, who's in, how to split, and each person's share.
 * Totals update as you type; the parent only saves when previewSplit() has no error.
 */
export function SplitEditor({ total, value, onChange, onTurnOff }: { total: number; value: SplitValue; onChange: (v: SplitValue) => void; onTurnOff?: () => void }) {
  const { data } = useData<SplitsData>("/api/splits");
  const [adding, setAdding] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const inSplit = (p: string) => value.people.some((x) => x.person.toLowerCase() === p.toLowerCase());
  const set = (patch: Partial<SplitValue>) => onChange({ ...value, ...patch });

  const addPerson = (raw: string) => {
    const p = raw.trim().replace(/^\w/, (c) => c.toUpperCase());
    if (!p || inSplit(p) || /^(me|you)$/i.test(p)) return;
    set({ people: [...value.people, { person: p, value: defaultValue(value.method, value.people.length + 1) }] });
  };
  const removePerson = (p: string) => {
    const people = value.people.filter((x) => x.person !== p);
    set({ people, paidBy: value.paidBy === p ? ME : value.paidBy });
  };
  const setMethod = (m: Method) => {
    // Start each method from a sensible split so the numbers already add up.
    const n = value.people.length;
    const totalPaise = Math.round(total * 100);
    const eq = n ? computeShares(totalPaise || n, "equal", value.people.map((p) => ({ person: p.person, value: 0 }))) : [];
    set({
      method: m,
      people: value.people.map((p, i) => ({
        person: p.person,
        value: m === "amount" ? (totalPaise ? eq[i].sharePaise / 100 : 0) : m === "percent" ? pct(n, i) : 1,
      })),
    });
  };

  const preview = previewSplit(total, value);
  const mine = preview.shares?.find((s) => s.person === ME)?.sharePaise || 0;
  const totalPaise = Math.round((total || 0) * 100);
  const suggestions = (data?.known || []).filter((k) => !inSplit(k)).slice(0, 8);

  return (
    <div className="rounded-2xl border border-indigo-400/40 bg-indigo-500/[0.06] p-3">
      {onTurnOff && (
        <div className="mb-2">
          <SplitToggle on onToggle={onTurnOff} />
        </div>
      )}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">Paid by</span>
        <span className="relative">
          <select
            value={value.paidBy}
            onChange={(e) => set({ paidBy: e.target.value })}
            className="appearance-none rounded-full bg-surface py-1 pl-3 pr-7 font-medium ring-1 ring-line outline-none"
            aria-label="Paid by"
          >
            {value.people.map((p) => (
              <option key={p.person} value={p.person}>
                {displayName(p.person)}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
        </span>
      </div>

      <label className={clsx(lbl, "mt-3")}>Split with</label>
      <div className="flex flex-wrap gap-1.5">
        {value.people.map((p) => (
          <button
            key={p.person}
            type="button"
            onClick={() => (p.person === ME ? set({ people: value.people.filter((x) => x.person !== ME) }) : removePerson(p.person))}
            className="flex items-center gap-1.5 rounded-full bg-surface py-1 pl-1 pr-2 text-xs font-medium ring-1 ring-indigo-400"
            aria-label={`Remove ${displayName(p.person)}`}
          >
            <Avatar name={p.person} size={20} /> {displayName(p.person)} <X className="h-3 w-3 text-muted" />
          </button>
        ))}
        {!inSplit(ME) && (
          <button type="button" onClick={() => set({ people: [{ person: ME, value: defaultValue(value.method, value.people.length + 1) }, ...value.people] })} className="flex items-center gap-1 rounded-full border border-dashed border-indigo-400 px-2.5 py-1 text-xs text-indigo-500">
            <Plus className="h-3 w-3" /> Me
          </button>
        )}
        <button type="button" onClick={() => setShowAdd((s) => !s)} className="flex items-center gap-1 rounded-full border border-dashed border-line px-2.5 py-1 text-xs text-muted">
          <Plus className="h-3 w-3" /> Person
        </button>
        {(data?.groups || []).map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => {
              const add = g.members.filter((m) => !inSplit(m));
              set({ people: [...value.people, ...add.map((m) => ({ person: m, value: defaultValue(value.method, value.people.length + add.length) }))] });
            }}
            className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:text-fg"
          >
            <Users className="h-3 w-3" /> {g.name}
          </button>
        ))}
      </div>

      {showAdd && (
        <div className="mt-2">
          <div className="flex gap-2">
            <input
              autoFocus
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  addPerson(adding);
                  setAdding("");
                }
              }}
              placeholder="Name"
              maxLength={40}
              className="min-w-0 flex-1 rounded-xl bg-surface px-3 py-2 text-sm ring-1 ring-line outline-none focus:ring-indigo-400"
            />
            <button
              type="button"
              disabled={!adding.trim()}
              onClick={() => {
                addPerson(adding);
                setAdding("");
              }}
              className="rounded-xl bg-indigo-500 px-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              Add
            </button>
          </div>
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => addPerson(s)} className="flex items-center gap-1 rounded-full bg-surface py-0.5 pl-0.5 pr-2 text-xs ring-1 ring-line">
                  <Avatar name={s} size={18} /> {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-raised p-1 text-xs">
        {(
          [
            ["equal", "Equally"],
            ["amount", "Amounts"],
            ["percent", "%"],
            ["shares", "Shares"],
          ] as const
        ).map(([k, t]) => (
          <button key={k} type="button" onClick={() => setMethod(k)} className={clsx("rounded-lg py-1.5 font-medium", value.method === k ? "bg-surface shadow-sm ring-1 ring-line" : "text-muted")}>
            {t}
          </button>
        ))}
      </div>

      <div className="mt-2 divide-y divide-line">
        {value.people.map((p, i) => {
          const share = preview.shares?.[i]?.sharePaise;
          return (
            <div key={p.person} className="flex items-center gap-3 py-2">
              <Avatar name={p.person} size={30} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {displayName(p.person)}
                {value.paidBy === p.person && <span className="ml-1.5 text-xs font-normal text-muted">paid</span>}
              </span>
              {value.method === "equal" ? (
                <span className="text-sm font-semibold tabular-nums">{share !== undefined ? inr(share) : "–"}</span>
              ) : (
                <>
                  {value.method !== "amount" && <span className="text-xs text-muted tabular-nums">{share !== undefined ? inr(share) : ""}</span>}
                  <span className="flex w-24 items-center justify-end gap-1 rounded-lg bg-surface px-2 py-1 ring-1 ring-line focus-within:ring-indigo-400">
                    {value.method === "amount" && <span className="text-xs text-muted">₹</span>}
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      value={p.value || ""}
                      placeholder="0"
                      onChange={(e) => set({ people: value.people.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) || 0 } : x)) })}
                      className="w-full min-w-0 bg-transparent text-right text-sm font-semibold tabular-nums outline-none"
                      aria-label={`${displayName(p.person)} ${value.method}`}
                    />
                    {value.method === "percent" && <span className="text-xs text-muted">%</span>}
                    {value.method === "shares" && <span className="text-xs text-muted">×</span>}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div
        className={clsx(
          "mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-surface px-3 py-2 text-xs ring-1",
          preview.error ? "ring-amber-400/60" : "ring-line",
        )}
      >
        {preview.error ? (
          <span className="font-medium text-amber-600 dark:text-amber-400">{preview.error}</span>
        ) : (
          <span className="flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" /> {value.method === "equal" ? "Split evenly" : "Adds up"}
          </span>
        )}
        {!preview.error && (
          <span className="text-muted">
            Your share <b className="text-fg">{inr(mine)}</b>
            {value.paidBy === ME ? (
              <>
                {" "}
                · you get back <b className="text-emerald-600 dark:text-emerald-400">{inr(totalPaise - mine)}</b>
              </>
            ) : (
              <>
                {" "}
                · you owe {displayName(value.paidBy)} <b className="text-amber-600 dark:text-amber-400">{inr(mine)}</b>
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/** Even percentages that add up to exactly 100 (the first person takes the rounding). */
function pct(n: number, i: number) {
  const base = Math.floor(10000 / n) / 100;
  return i === 0 ? +(100 - base * (n - 1)).toFixed(2) : base;
}

function defaultValue(method: Method, n: number) {
  return method === "shares" ? 1 : method === "percent" ? +(100 / n).toFixed(2) : 0;
}

/** The header row with the on/off switch. */
export function SplitToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle} className="flex w-full items-center gap-2 py-1 text-left">
      <Split className="h-4 w-4 text-indigo-500" />
      <span className="flex-1 text-sm font-semibold">Split this bill</span>
      <span className={clsx("relative h-6 w-11 shrink-0 rounded-full transition", on ? "bg-indigo-500" : "bg-line")}>
        <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
      </span>
    </button>
  );
}
