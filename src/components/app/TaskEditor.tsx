"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Star } from "lucide-react";
import { dayKey } from "./client";
import { field, label } from "./ReminderEditor";
import type { TaskInput } from "../types";

function nextSaturday() {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return dayKey(d);
}

/** Editable fields for a task (to-do without a clock time). */
export function TaskEditor({
  value,
  onChange,
  autoFocus,
  onSubmit,
}: {
  value: TaskInput;
  onChange: (v: TaskInput) => void;
  autoFocus?: boolean;
  /** Called when Enter is pressed in the title box. */
  onSubmit?: () => void;
}) {
  const set = <K extends keyof TaskInput>(k: K, v: TaskInput[K]) => onChange({ ...value, [k]: v });
  const [quick] = useState<[string, string | null][]>(() => [
    ["No date", null],
    ["Today", dayKey(new Date())],
    ["Tomorrow", dayKey(new Date(Date.now() + 86400000))],
    ["Weekend", nextSaturday()],
  ]);
  const chip = (on: boolean) =>
    clsx(
      "rounded-full border px-3 py-1.5 text-xs font-medium",
      on ? "border-indigo-400 bg-indigo-500/15 text-indigo-600 dark:text-indigo-200" : "border-line text-muted hover:bg-raised",
    );

  return (
    <div className="grid gap-4">
      <div>
        <label className={label}>What needs doing?</label>
        <input
          className={field}
          autoFocus={autoFocus}
          placeholder="e.g. Buy milk, Finish report"
          value={value.title}
          maxLength={200}
          onChange={(e) => set("title", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onSubmit) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={value.focus}
        onClick={() => set("focus", !value.focus)}
        className={clsx(
          "flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition",
          value.focus ? "border-amber-400 bg-amber-500/10" : "border-line hover:bg-raised",
        )}
      >
        <Star className={clsx("h-5 w-5 shrink-0", value.focus ? "fill-amber-400 text-amber-400" : "text-subtle")} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Add to today&apos;s focus</span>
          <span className="block text-xs text-muted">Shows at the top of Home. If unfinished, it carries over to tomorrow.</span>
        </span>
        {/* A clear on/off switch so it's obvious whether it's on. */}
        <span className={clsx("relative h-6 w-11 shrink-0 rounded-full transition", value.focus ? "bg-amber-400" : "bg-line")}>
          <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", value.focus ? "left-[22px]" : "left-0.5")} />
        </span>
      </button>

      <div>
        <label className={label}>Due (optional)</label>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {quick.map(([l, d]) => (
            <button key={l} type="button" className={chip((value.dueDate || null) === d)} onClick={() => set("dueDate", d)}>
              {l}
            </button>
          ))}
        </div>
        <input type="date" className={field} value={value.dueDate || ""} onChange={(e) => set("dueDate", e.target.value || null)} />
      </div>

      <div>
        <label className={label}>Priority</label>
        <div className="flex gap-1">
          {(["low", "normal", "high"] as const).map((p) => (
            <button key={p} type="button" onClick={() => set("priority", p)} className={clsx("flex-1 capitalize", chip(value.priority === p))}>
              {p}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={label}>Notes</label>
        <input className={field} value={value.notes || ""} onChange={(e) => set("notes", e.target.value || null)} />
      </div>
    </div>
  );
}
