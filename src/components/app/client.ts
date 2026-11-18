"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Kolkata";

export class ApiError extends Error {}

/** JSON fetch that redirects to login on 401 and throws readable errors. */
export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.json !== undefined ? { "content-type": "application/json" } : {}), ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
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
