"use client";

import { useSyncExternalStore } from "react";
import { refreshAll } from "./client";

/**
 * "Hide amounts": balances, totals and every ₹ figure show as ₹•••• until you tap the eye again.
 * Remembered on this device and applied before anything loads.
 */
const KEY = "remindo:hideAmounts";
type G = { __remindoHideAmounts?: boolean };
const listeners = new Set<() => void>();

function read() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

// Set the flag as soon as this file loads in the browser, before any amount is shown.
if (typeof window !== "undefined") (globalThis as G).__remindoHideAmounts = read();

export function setHideAmounts(hide: boolean) {
  (globalThis as G).__remindoHideAmounts = hide;
  try {
    localStorage.setItem(KEY, hide ? "1" : "0");
  } catch {
    // private mode: works until the page is closed
  }
  listeners.forEach((l) => l());
  // Re-draw every screen with (or without) the amounts.
  refreshAll();
}

export function useHideAmounts() {
  const hidden = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const onStorage = (e: StorageEvent) => {
        if (e.key === KEY) {
          (globalThis as G).__remindoHideAmounts = e.newValue === "1";
          cb();
          refreshAll();
        }
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", onStorage);
      };
    },
    () => Boolean((globalThis as G).__remindoHideAmounts),
    () => false,
  );
  return { hidden, toggle: () => setHideAmounts(!hidden) };
}
