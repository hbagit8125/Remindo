"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { CheckCircle2, AlertCircle, Undo2 } from "lucide-react";
import { api, takeRecentUndos, undoChanges, withoutUndoCapture } from "./client";

type Toast = {
  id: number;
  message: string;
  tone?: "ok" | "error";
  action?: { label: string; onClick: () => void };
  duration: number;
  onExpire?: () => void;
  /** History entries this toast can undo (filled in automatically from the change that just happened). */
  undoIds?: string[];
};

type Ctx = {
  toast: (t: Omit<Toast, "id" | "duration"> & { duration?: number }) => void;
  /** Hide something now, commit after a few seconds unless the user taps Undo. */
  undoable: (message: string, commit: () => Promise<unknown> | void, revert: () => void) => void;
};

const ToastCtx = createContext<Ctx | null>(null);

export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error("useToast outside ToastProvider");
  return c;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Toast | null>(null);
  const seq = useRef(0);

  const finish = useCallback((t: Toast | null) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    t?.onExpire?.();
    pending.current = null;
    setCurrent((c) => (c?.id === t?.id ? null : c));
  }, []);

  const show = useCallback(
    (t: Toast) => {
      // A new toast commits whatever the previous one was waiting on.
      if (pending.current) finish(pending.current);
      pending.current = t;
      setCurrent(t);
      timer.current = setTimeout(() => finish(t), t.duration);
    },
    [finish],
  );

  const toast: Ctx["toast"] = useCallback(
    (t) => {
      // Every change the server recorded gets an Undo button, unless this toast already undoes it.
      const ids = t.tone === "error" ? [] : takeRecentUndos();
      const undoIds = ids.length && t.action?.label !== "Undo" ? ids : undefined;
      show({ ...t, undoIds, id: ++seq.current, duration: t.duration ?? (t.action || undoIds ? 7000 : 2500) });
    },
    [show],
  );

  const notify = useCallback((message: string, tone: "ok" | "error") => show({ id: ++seq.current, message, tone, duration: 3000 }), [show]);

  const runUndo = useCallback(
    async (ids: string[]) => {
      try {
        const r = await undoChanges(ids);
        show({ id: ++seq.current, message: r.ok ? `↩️ ${r.message}` : r.message, tone: r.ok ? "ok" : "error", duration: 3000 });
      } catch (e) {
        show({ id: ++seq.current, message: (e as Error).message, tone: "error", duration: 4000 });
      }
    },
    [show],
  );

  const undoable: Ctx["undoable"] = useCallback(
    (message, commit, revert) => {
      takeRecentUndos(); // this toast has its own Undo
      let undone = false;
      const t: Toast = {
        id: ++seq.current,
        message,
        duration: 8000,
        action: {
          label: "Undo",
          onClick: () => {
            undone = true;
            revert();
          },
        },
        onExpire: () => {
          // Delayed delete: it's in History, but the next toast shouldn't offer to undo it.
          if (!undone) void withoutUndoCapture(commit);
        },
      };
      show(t);
    },
    [show],
  );

  // Commit pending work if the tab is closed.
  useEffect(() => {
    const flush = () => pending.current && finish(pending.current);
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [finish]);

  return (
    <ToastCtx.Provider value={{ toast, undoable }}>
      <UndoShortcut onUndo={notify} />
      {children}
      {current && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex justify-center px-4 md:bottom-6">
          <div
            key={current.id}
            className="animate-pop pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-2xl ring-1 ring-white/10 dark:bg-zinc-800"
          >
            {current.tone === "error" ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            )}
            <span className="min-w-0 flex-1">{current.message}</span>
            {current.action && (
              <button
                onClick={() => {
                  current.action!.onClick();
                  if (timer.current) clearTimeout(timer.current);
                  pending.current = null;
                  setCurrent(null);
                }}
                className={clsx("shrink-0 rounded-lg px-2 py-1 font-semibold text-indigo-300 hover:bg-white/10")}
              >
                {current.action.label}
              </button>
            )}
            {current.undoIds && (
              <button
                onClick={() => {
                  const ids = current.undoIds!;
                  if (timer.current) clearTimeout(timer.current);
                  pending.current = null;
                  setCurrent(null);
                  void runUndo(ids);
                }}
                className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-semibold text-indigo-300 hover:bg-white/10"
              >
                <Undo2 className="h-3.5 w-3.5" /> Undo
              </button>
            )}
          </div>
        </div>
      )}
    </ToastCtx.Provider>
  );
}

/** Ctrl/⌘+Z anywhere (outside text boxes): undo your last change. */
function UndoShortcut({ onUndo }: { onUndo: (message: string, tone: "ok" | "error") => void }) {
  useEffect(() => {
    const on = async (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      try {
        const { items } = await api<{ items: { id: string; undoneAt: string | null }[] }>("/api/activity");
        const last = items.find((i) => !i.undoneAt);
        if (!last) return onUndo("Nothing to undo", "ok");
        const r = await undoChanges([last.id]);
        onUndo(r.ok ? `↩️ ${r.message}` : r.message, r.ok ? "ok" : "error");
      } catch (err) {
        onUndo((err as Error).message, "error");
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onUndo]);
  return null;
}
