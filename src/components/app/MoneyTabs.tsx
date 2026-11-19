"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

const TABS = [
  { href: "/expenses", label: "Entries" },
  { href: "/insights", label: "Insights" },
  { href: "/accounts", label: "Accounts" },
  { href: "/goals", label: "Goals" },
  { href: "/dues", label: "Dues" },
];

/** Sub-navigation for the Money tab. */
export function MoneyTabs() {
  const path = usePathname();
  return (
    <div className="no-scrollbar -mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={clsx(
            "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition",
            path.startsWith(t.href) ? "border-fg bg-fg text-[var(--bg)]" : "border-line text-muted hover:text-fg",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
