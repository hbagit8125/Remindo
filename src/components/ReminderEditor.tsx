"use client";

import { clsx } from "clsx";
import { LEAD_OPTIONS, WEEKDAY_LIST, type ReminderInput } from "./types";

const field =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400";
const label = "mb-1 block text-xs font-medium text-zinc-400";

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
                  "flex-1 rounded-lg border px-2 py-2 text-xs font-medium capitalize transition",
                  value.priority === p
                    ? p === "high"
                      ? "border-rose-400 bg-rose-500/20 text-rose-200"
                      : p === "normal"
                        ? "border-indigo-400 bg-indigo-500/20 text-indigo-200"
                        : "border-zinc-400 bg-zinc-500/20 text-zinc-200"
                    : "border-white/10 text-zinc-400 hover:bg-white/5",
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
                      "h-8 w-10 rounded-lg border text-xs font-medium",
                      on ? "border-indigo-400 bg-indigo-500/20 text-indigo-200" : "border-white/10 text-zinc-400",
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
                  "rounded-full border px-3 py-1 text-xs",
                  on ? "border-emerald-400 bg-emerald-500/15 text-emerald-200" : "border-white/10 text-zinc-400",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className={label}>Notes</label>
          <input className={field} value={value.notes || ""} onChange={(e) => set("notes", e.target.value || null)} />
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
    </div>
  );
}
