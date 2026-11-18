"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { CheckCircle2, AlertCircle } from "lucide-react";

type Toast = {
  id: number;
  message: string;
  tone?: "ok" | "error";
  action?: { label: string; onClick: () => void };
  duration: number;
  onExpire?: () => void;
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
    (t) => show({ ...t, id: ++seq.current, duration: t.duration ?? (t.action ? 5000 : 2500) }),
    [show],
  );

  const undoable: Ctx["undoable"] = useCallback(
    (message, commit, revert) => {
      let undone = false;
      const t: Toast = {
        id: ++seq.current,
        message,
        duration: 5000,
        action: {
          label: "Undo",
          onClick: () => {
            undone = true;
            revert();
          },
        },
        onExpire: () => {
          if (!undone) void commit();
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
          </div>
        </div>
      )}
    </ToastCtx.Provider>
  );
}
