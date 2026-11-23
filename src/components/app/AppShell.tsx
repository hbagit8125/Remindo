"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { AlarmClock, CalendarCheck, Home, LayoutGrid, LogOut, Moon, Plus, Search, Sun, Wallet } from "lucide-react";
import { OfflineBanner } from "./OfflineBanner";
import { refreshAll } from "./client";
import { SearchOverlay } from "./SearchOverlay";
import type { SheetMode } from "./AddSheet";
import { SheetProvider, useSheet } from "./AddSheet";
import { ToastProvider } from "./toast";

const NAV = [
  { href: "/", label: "Home", icon: Home, match: ["/"] },
  { href: "/plan", label: "Plan", icon: CalendarCheck, match: ["/plan", "/reminders"] },
  { href: "/expenses", label: "Money", icon: Wallet, match: ["/expenses", "/insights", "/accounts", "/goals", "/dues"] },
  { href: "/more", label: "More", icon: LayoutGrid, match: ["/more", "/life", "/lists", "/categories"] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <SheetProvider>
        <Frame>{children}</Frame>
      </SheetProvider>
    </ToastProvider>
  );
}

export function useTheme() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the class set before paint
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  };
  return { dark, toggle };
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  // Locked: don't leave your data readable in the offline cache.
  if ("caches" in window) await caches.delete("remindo-v2").catch(() => null);
  window.location.href = "/login";
}

function Frame({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { open } = useSheet();
  const theme = useTheme();
  const isActive = (href: string) => {
    const n = NAV.find((x) => x.href === href);
    return (n?.match || [href]).some((m) => (m === "/" ? path === "/" : path.startsWith(m)));
  };

  // Register the service worker (needed for push notifications).
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => null);
  }, []);

  // Things ticked off on Telegram, email or a notification show up here within a minute
  // while the app is open (and straight away when you switch back to it).
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) refreshAll();
    }, 45_000);
    return () => clearInterval(t);
  }, []);

  const [searchOpen, setSearchOpen] = useState(false);

  // Keyboard: "n" opens the add sheet, "/" opens search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (el instanceof Element && el.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "n") {
        e.preventDefault();
        open({ mode: "ask" });
      } else if (e.key === "/") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Home-screen shortcuts open the app at /?add=expense etc.
  useEffect(() => {
    const url = new URL(window.location.href);
    const add = url.searchParams.get("add") as SheetMode | "search" | null;
    if (!add) return;
    const text = url.searchParams.get("text") || undefined;
    url.searchParams.delete("add");
    url.searchParams.delete("text");
    window.history.replaceState(null, "", url.pathname + url.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the launch URL
    if (add === "search") setSearchOpen(true);
    else if (add === "ask") open({ mode: "ask", text });
    else if (["reminder", "task", "expense"].includes(add)) open({ mode: add as "reminder" | "task" | "expense" });
  }, [open]);

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line px-4 py-6 md:flex">
        <Link href="/" className="mb-8 flex items-center gap-2.5 px-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-pink-500 shadow-lg shadow-indigo-500/30">
            <AlarmClock className="h-5 w-5 text-white" />
          </span>
          <span className="text-lg font-semibold tracking-tight">Remindo</span>
        </Link>
        <button
          onClick={() => open({ mode: "ask" })}
          className="mb-6 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 hover:brightness-110"
        >
          <Plus className="h-4 w-4" /> Add
          <kbd className="ml-1 rounded bg-white/20 px-1.5 text-[10px] font-medium">N</kbd>
        </button>
        <button
          onClick={() => setSearchOpen(true)}
          className="-mt-3 mb-6 flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-muted hover:bg-raised hover:text-fg"
        >
          <Search className="h-4 w-4" /> Search
          <kbd className="ml-auto rounded bg-raised px-1.5 text-[10px]">/</kbd>
        </button>
        <nav className="space-y-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={clsx(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                isActive(n.href) ? "bg-raised text-fg" : "text-muted hover:bg-raised hover:text-fg",
              )}
            >
              <n.icon className="h-[18px] w-[18px]" />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-1">
          <button onClick={theme.toggle} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-raised hover:text-fg">
            {theme.dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
            {theme.dark ? "Light mode" : "Dark mode"}
          </button>
          <button onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-raised hover:text-fg">
            <LogOut className="h-[18px] w-[18px]" /> Lock
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile top bar */}
        <header className="flex items-center justify-between px-4 pb-1 pt-4 md:hidden">
          <span className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-pink-500">
              <AlarmClock className="h-4 w-4 text-white" />
            </span>
            <span className="font-semibold tracking-tight">Remindo</span>
          </span>
          <span className="flex gap-1">
            <button onClick={() => setSearchOpen(true)} aria-label="Search" className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-raised">
              <Search className="h-5 w-5" />
            </button>
            <button onClick={theme.toggle} aria-label="Toggle theme" className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-raised">
              {theme.dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
          </span>
        </header>

        <main className="mx-auto w-full max-w-3xl px-4 pb-32 pt-3 md:px-8 md:pb-12 md:pt-8">
          <OfflineBanner />
          {children}
        </main>
      </div>

      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}

      {/* Mobile bottom nav */}
      <nav className="bottom-nav pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-[var(--bg)]/90 backdrop-blur-xl md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 items-center px-2 pt-1.5">
          {NAV.slice(0, 2).map((n) => (
            <NavItem key={n.href} {...n} active={isActive(n.href)} />
          ))}
          <div className="flex justify-center">
            <button
              onClick={() => open({ mode: "ask" })}
              aria-label="Add"
              className="-mt-6 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-xl shadow-indigo-500/40 active:scale-95"
            >
              <Plus className="h-7 w-7" />
            </button>
          </div>
          {NAV.slice(2).map((n) => (
            <NavItem key={n.href} {...n} active={isActive(n.href)} />
          ))}
        </div>
      </nav>
    </div>
  );
}

function NavItem({ href, label, icon: Icon, active }: { href: string; label: string; icon: typeof Home; active: boolean }) {
  return (
    <Link href={href} className={clsx("flex flex-col items-center gap-0.5 py-1.5 text-[11px] font-medium", active ? "text-indigo-500" : "text-subtle")}>
      <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 2} />
      {label}
    </Link>
  );
}
