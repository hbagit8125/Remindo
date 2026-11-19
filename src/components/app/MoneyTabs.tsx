"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

/** Entries | Insights switch at the top of the Money tab. */
export function MoneyTabs() {
  const path = usePathname();
  const tabs = [
    { href: "/expenses", label: "Entries" },
    { href: "/insights", label: "Insights" },
  ];
  return (
    <div className="mb-5 flex w-full gap-1 rounded-2xl bg-raised p-1 sm:w-72">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={clsx(
            "flex-1 rounded-xl py-2 text-center text-sm font-medium transition",
            path.startsWith(t.href) ? "bg-surface text-fg shadow-sm ring-1 ring-line" : "text-muted hover:text-fg",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
