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
    // All five fit on a phone (no hidden "Dues" off to the side).
    <div className="mb-5 grid grid-cols-5 gap-1 rounded-2xl bg-raised p-1 md:flex md:w-fit md:gap-1.5">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={clsx(
            "rounded-xl px-1 py-2 text-center text-[13px] font-medium transition md:px-4 md:text-sm",
            path.startsWith(t.href) ? "bg-surface text-fg shadow-sm ring-1 ring-line" : "text-muted hover:text-fg",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
