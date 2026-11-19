import { and, eq, gte } from "drizzle-orm";
import { db, reminders, transactions } from "@/db";
import { getSetting, setSetting } from "./settings";
import { formatINR } from "./money";
import { fmtLocal } from "./time";
import { createReminders } from "./create";

export type Suggestion = {
  key: string;
  kind: "recurring_bill" | "favourite";
  title: string;
  body: string;
  cta: string;
  /** What "accept" creates. */
  payload: Record<string, unknown>;
};

const norm = (s: string | null) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(bill|payment|paid|pay|monthly|for|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Spots patterns worth a reminder: the same payment in 2+ of the last 3 months
 * on a similar day, with no reminder for it yet. Plus favourite suggestions.
 */
export async function getSuggestions(now = new Date()): Promise<Suggestion[]> {
  const dismissed = new Set((await getSetting<string[]>("dismissedSuggestions")) || []);
  const since = fmtLocal(new Date(now.getTime() - 100 * 86400000), "yyyy-MM-dd");
  const rows = await db()
    .select()
    .from(transactions)
    .where(and(eq(transactions.type, "expense"), gte(transactions.date, since)));
  const active = await db().select({ title: reminders.title }).from(reminders).where(eq(reminders.status, "active"));
  const activeTitles = active.map((r) => norm(r.title));

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!["Bills", "Rent", "EMI/Loans", "Subscriptions", "Education", "Health"].includes(r.category)) continue;
    const k = norm(r.merchant || r.note) || r.category.toLowerCase();
    groups.set(k, [...(groups.get(k) || []), r]);
  }

  const out: Suggestion[] = [];
  for (const [k, list] of groups) {
    const months = new Set(list.map((r) => r.date.slice(0, 7)));
    if (months.size < 2) continue;
    const days = list.map((r) => Number(r.date.slice(8)));
    const avgDay = Math.round(days.reduce((a, b) => a + b, 0) / days.length);
    if (Math.max(...days) - Math.min(...days) > 8) continue; // not a regular day of month
    if (activeTitles.some((t) => t.includes(k) || (k.length > 3 && k.includes(t)))) continue;
    const key = `bill:${k}`;
    if (dismissed.has(key)) continue;
    const avgAmount = Math.round(list.reduce((s, r) => s + r.amountPaise, 0) / list.length);
    const label = list[0].note || list[0].merchant || list[0].category;
    out.push({
      key,
      kind: "recurring_bill",
      title: `${label} looks monthly`,
      body: `You paid ~${formatINR(avgAmount)} around the ${avgDay}${["th", "st", "nd", "rd"][avgDay % 10 > 3 || [11, 12, 13].includes(avgDay) ? 0 : avgDay % 10]} in ${months.size} recent months. Add a monthly reminder?`,
      cta: "Add reminder",
      payload: { title: `Pay ${label}`, day: Math.min(avgDay, 28), amount: avgAmount / 100, category: list[0].category },
    });
  }

  // Favourite suggestions are shown in the Quick log strip instead, so they aren't repeated here.
  return out.slice(0, 3);
}

export async function dismissSuggestion(key: string) {
  const list = (await getSetting<string[]>("dismissedSuggestions")) || [];
  if (!list.includes(key)) await setSetting("dismissedSuggestions", [...list.slice(-200), key]);
}

export async function acceptSuggestion(key: string, now = new Date()) {
  const s = (await getSuggestions(now)).find((x) => x.key === key);
  if (!s) return null;
  if (s.kind === "recurring_bill") {
    const p = s.payload as { title: string; day: number; amount: number; category: string };
    const today = fmtLocal(now, "yyyy-MM-dd");
    const [y, m] = today.split("-").map(Number);
    let date = `${y}-${String(m).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
    if (date <= today) date = m === 12 ? `${y + 1}-01-${String(p.day).padStart(2, "0")}` : `${y}-${String(m + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
    await createReminders([
      { title: p.title, date, time: null, recurrence: "monthly", interval: 1, priority: "high", category: "finance", amount: p.amount, leadTimes: [2880, 0] },
    ]);
  } else {
    const { favourites } = await import("@/db");
    const p = s.payload as { label: string; payload: object };
    await db().insert(favourites).values({ label: p.label, payload: p.payload });
  }
  await dismissSuggestion(key);
  return s;
}
