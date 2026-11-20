"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, registerCustomCategories, type CategoryData } from "../types";

export const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Kolkata";

export class ApiError extends Error {}

// ------------------------------------------------------------- offline queue

/** Changes that can safely wait for the network: adding entries, ticking things off. */
const QUEUEABLE = /^\/api\/(reminders|transactions|tasks|occurrence|list-items|lists\/add|lists\/[^/]+\/items|favourites\/[^/]+|dues|goals\/[^/]+)(\/|$|\?)/;
const QUEUE_KEY = "offlineQueue";
export const QUEUE_EVENT = "remindo:queue";
type Queued = { url: string; method: string; body: string | null; at: number };

export function readQueue(): Queued[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}
function writeQueue(q: Queued[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {}
  window.dispatchEvent(new Event(QUEUE_EVENT));
}

let flushing = false;
/** Send queued changes in order. Stops at the first network failure; drops ones the server rejects. */
export async function flushQueue() {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    let q = readQueue();
    while (q.length) {
      const item = q[0];
      try {
        const res = await fetch(item.url, { method: item.method, headers: item.body ? { "content-type": "application/json" } : {}, body: item.body });
        if (res.status === 401) break;
      } catch {
        break; // still offline
      }
      q = q.slice(1);
      writeQueue(q);
      sent++;
    }
  } finally {
    flushing = false;
  }
  if (sent) refreshAll();
  return sent;
}

/** JSON fetch that redirects to login on 401 and throws readable errors. Offline changes are queued. */
export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  const body = init?.json !== undefined ? JSON.stringify(init.json) : (init?.body as string | undefined);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init?.json !== undefined ? { "content-type": "application/json" } : {}), ...init?.headers },
      body,
    });
  } catch (e) {
    if (method !== "GET" && QUEUEABLE.test(url) && (typeof body === "string" || body === undefined)) {
      writeQueue([...readQueue(), { url, method, body: body ?? null, at: Date.now() }]);
      return { queued: true } as T;
    }
    throw new ApiError(navigator.onLine ? (e as Error).message : "You're offline. This needs the internet");
  }
  if (res.status === 401) {
    window.location.href = "/login";
    throw new ApiError("Signed out");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`);
  return data as T;
}

const REFRESH = "remindo:refresh";

/** Tell every screen to reload its data (after adding, editing, deleting). */
export function refreshAll() {
  window.dispatchEvent(new Event(REFRESH));
}

/** Load JSON and reload whenever refreshAll() is called. */
export function useData<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!url) return;
    try {
      setData(await api<T>(url));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [url]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
    const onRefresh = () => load();
    window.addEventListener(REFRESH, onRefresh);
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener(REFRESH, onRefresh);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  return { data, error, loading: data === null && !error, reload: load, setData };
}

// ------------------------------------------------------------- dates

const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: TZ, ...o });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export const fmt = {
  time: f({ hour: "numeric", minute: "2-digit", hour12: true }),
  dayLong: f({ weekday: "long", day: "numeric", month: "short" }),
  dayShort: f({ weekday: "short", day: "numeric", month: "short" }),
  dayNum: f({ day: "numeric", month: "short" }),
  month: f({ month: "long", year: "numeric" }),
  hour: new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }),
};

/** YYYY-MM-DD in the app timezone. */
export const dayKey = (d: Date) => dayKeyFmt.format(d);
export const monthKey = (d: Date) => dayKey(d).slice(0, 7);

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const monthLabel = (month: string) => fmt.month.format(new Date(`${month}-15T12:00:00Z`));

/** "Today", "Yesterday" or "Mon, 17 Nov" for a YYYY-MM-DD string. */
export function relativeDay(date: string, now = new Date()) {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86400000));
  const tomorrow = dayKey(new Date(now.getTime() + 86400000));
  if (date === today) return "Today";
  if (date === yesterday) return "Yesterday";
  if (date === tomorrow) return "Tomorrow";
  return fmt.dayShort.format(new Date(`${date}T12:00:00+05:30`));
}

export function greeting(now = new Date()) {
  const h = Number(fmt.hour.format(now));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

// ------------------------------------------------------------- pending deletes

/** Ids hidden while an undoable delete is waiting to commit. */
let hidden = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function hideId(id: string) {
  hidden = new Set(hidden).add(id);
  emit();
}
export function unhideId(id: string) {
  hidden = new Set(hidden);
  hidden.delete(id);
  emit();
}
export function useHidden() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => hidden,
    () => hidden,
  );
}

/** Your categories (built-in minus hidden, plus your own). Also teaches categoryMeta their emojis. */
export function useCategories() {
  const r = useData<CategoryData>("/api/categories");
  if (r.data) registerCustomCategories(r.data.custom);
  return {
    ...r,
    expense: r.data?.expense || EXPENSE_CATEGORIES,
    income: r.data?.income || INCOME_CATEGORIES,
  };
}
