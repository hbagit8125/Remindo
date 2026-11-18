"use client";

import { clsx } from "clsx";
import { LEAD_OPTIONS, WEEKDAY_LIST, type ReminderInput } from "../types";

export const field =
  "w-full rounded-xl border border-line bg-raised px-3 py-2.5 text-[15px] text-fg outline-none placeholder:text-subtle focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20";
export const label = "mb-1.5 block text-xs font-medium text-muted";
const chipOff = "border-line text-muted hover:bg-raised";

const DEFAULT_LEADS = { high: [10080, 1440, 0], normal: [0], low: [0] };

/** Editable fields for one reminder. Used for AI drafts, manual add and edit. */
export function ReminderEditor({ value, onChange }: { value: ReminderInput; onChange: (v: ReminderInput) => void }) {
  const set = <K extends keyof ReminderInput>(k: K, v: ReminderInput[K]) => onChange({ ...value, [k]: v });
  const leads = value.leadTimes?.length ? value.leadTimes : DEFAULT_LEADS[value.priority];

  return (
    <div className="grid gap-3">
      <div>
        <label className={label}>Title</label>
        <input className={field} value={value.title} onChange={(e) => set("title", e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Date</label>
          <input type="date" className={field} value={value.date} onChange={(e) => set("date", e.target.value)} />
        </div>
        <div>
          <label className={label}>Time (empty = all day)</label>
          <input
            type="time"
            className={field}
            value={value.time || ""}
            onChange={(e) => set("time", e.target.value || null)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Repeats</label>
          <select
            className={field}
            value={value.recurrence}
            onChange={(e) => set("recurrence", e.target.value as ReminderInput["recurrence"])}
          >
            <option value="none">Doesn&apos;t repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        <div>
          <label className={label}>Priority</label>
          <div className="flex gap-1">
            {(["low", "normal", "high"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onChange({ ...value, priority: p, leadTimes: null })}
                className={clsx(
                  "flex-1 rounded-xl border px-2 py-2.5 text-xs font-medium capitalize transition",
                  value.priority === p
                    ? p === "high"
                      ? "border-rose-400 bg-rose-500/15 text-rose-600 dark:text-rose-200"
                      : p === "normal"
                        ? "border-indigo-400 bg-indigo-500/15 text-indigo-600 dark:text-indigo-200"
                        : "border-zinc-400 bg-zinc-500/15 text-zinc-600 dark:text-zinc-200"
                    : chipOff,
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {value.recurrence !== "none" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Every</label>
            <input
              type="number"
              min={1}
              className={field}
              value={value.interval}
              onChange={(e) => set("interval", Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <div>
            <label className={label}>Until (optional)</label>
            <input
              type="date"
              className={field}
              value={value.until || ""}
              onChange={(e) => set("until", e.target.value || null)}
            />
          </div>
          {value.recurrence === "weekly" && (
            <div className="col-span-2 flex flex-wrap gap-1">
              {WEEKDAY_LIST.map((d) => {
                const on = value.weekdays?.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() =>
                      set("weekdays", on ? (value.weekdays || []).filter((x) => x !== d) : [...(value.weekdays || []), d])
                    }
                    className={clsx(
                      "h-9 w-11 rounded-lg border text-xs font-medium",
                      on ? "border-indigo-400 bg-indigo-500/15 text-indigo-600 dark:text-indigo-200" : chipOff,
                    )}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div>
        <label className={label}>Alert me</label>
        <div className="flex flex-wrap gap-1">
          {LEAD_OPTIONS.map((o) => {
            const on = leads.includes(o.min);
            return (
              <button
                key={o.min}
                type="button"
                onClick={() => {
                  const next = on ? leads.filter((x) => x !== o.min) : [...leads, o.min];
                  set("leadTimes", next.length ? next.sort((a, b) => b - a) : [0]);
                }}
                className={clsx(
                  "rounded-full border px-3 py-1.5 text-xs",
                  on ? "border-emerald-400 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200" : chipOff,
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Bill amount (optional)</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">₹</span>
            <input
              type="number"
              inputMode="decimal"
              placeholder="e.g. 15000"
              className={clsx(field, "pl-7")}
              value={value.amount ?? ""}
              onChange={(e) => set("amount", e.target.value ? Number(e.target.value) : null)}
            />
          </div>
        </div>
        <div>
          <label className={label}>Category</label>
          <input
            className={field}
            value={value.category || ""}
            onChange={(e) => set("category", e.target.value || null)}
          />
        </div>
      </div>
      <div>
        <label className={label}>Notes</label>
        <input className={field} value={value.notes || ""} onChange={(e) => set("notes", e.target.value || null)} />
      </div>
    </div>
  );
}
