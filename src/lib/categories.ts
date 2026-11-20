import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { budgets, db, favourites, transactions } from "@/db";
import { DEFAULT_CATEGORIES, INCOME_CATEGORIES } from "./money";
import { getSetting, setSetting } from "./settings";

export type CustomCategory = { name: string; emoji: string; type: "expense" | "income" };
type Stored = { custom: CustomCategory[]; hidden: string[] };

const KEY = "categories";
const RESERVED = new Set(["Other", "Transfer", "Refund"]);

async function load(): Promise<Stored> {
  const s = await getSetting<Partial<Stored>>(KEY).catch(() => null);
  return { custom: s?.custom || [], hidden: s?.hidden || [] };
}

/** Everything the app needs to show and pick categories. Hidden ones are left out of `expense`/`income`. */
export async function getCategories() {
  const s = await load();
  const visible = (list: readonly string[], type: "expense" | "income") => [
    ...list.filter((c) => !s.hidden.includes(c) || c === "Other"),
    ...s.custom.filter((c) => c.type === type).map((c) => c.name),
  ];
  // "Other" always last so new ones appear before it.
  const otherLast = (l: string[]) => [...l.filter((c) => c !== "Other"), "Other"];
  return {
    expense: otherLast(visible(DEFAULT_CATEGORIES, "expense")),
    income: otherLast(visible(INCOME_CATEGORIES, "income")),
    custom: s.custom,
    hidden: s.hidden,
  };
}

const name = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .transform((x) => x.replace(/\s+/g, " ").replace(/^\w/, (c) => c.toUpperCase()));
export const categoryInputSchema = z.object({
  name,
  emoji: z.string().trim().min(1).max(8).default("🏷️"),
  type: z.enum(["expense", "income"]).default("expense"),
});

const exists = (s: Stored, n: string) =>
  [...DEFAULT_CATEGORIES, ...INCOME_CATEGORIES, ...s.custom.map((c) => c.name)].some((c) => c.toLowerCase() === n.toLowerCase());

export async function addCategory(raw: z.input<typeof categoryInputSchema>) {
  const input = categoryInputSchema.parse(raw);
  const s = await load();
  if (exists(s, input.name)) {
    // Adding a hidden built-in just shows it again.
    const builtIn = [...DEFAULT_CATEGORIES, ...INCOME_CATEGORIES].find((c) => c.toLowerCase() === input.name.toLowerCase());
    if (builtIn && s.hidden.includes(builtIn)) {
      await setSetting(KEY, { ...s, hidden: s.hidden.filter((h) => h !== builtIn) });
      return { name: builtIn };
    }
    throw new Error(`"${input.name}" already exists`);
  }
  await setSetting(KEY, { ...s, custom: [...s.custom, input] });
  return input;
}

/** Rename and/or change the emoji of your own category. Past entries, budgets and favourites follow the new name. */
export async function updateCategory(from: string, patch: { name?: string; emoji?: string }) {
  const s = await load();
  const cur = s.custom.find((c) => c.name === from);
  if (!cur) throw new Error("Only your own categories can be renamed");
  const to = patch.name ? name.parse(patch.name) : from;
  if (to.toLowerCase() !== from.toLowerCase() && exists(s, to)) throw new Error(`"${to}" already exists`);
  await setSetting(KEY, { ...s, custom: s.custom.map((c) => (c.name === from ? { ...c, name: to, emoji: patch.emoji || c.emoji } : c)) });
  if (to !== from) await moveEntries(from, to);
  return { name: to };
}

/** Delete your own category; its entries move to "Other". */
export async function deleteCategory(n: string) {
  const s = await load();
  if (!s.custom.some((c) => c.name === n)) throw new Error("Built-in categories can be hidden, not deleted");
  await setSetting(KEY, { ...s, custom: s.custom.filter((c) => c.name !== n) });
  await moveEntries(n, "Other");
  await db().delete(budgets).where(eq(budgets.category, n));
}

/** Hide or show a built-in category in the picker. Old entries keep it. */
export async function setHidden(n: string, hidden: boolean) {
  if (RESERVED.has(n)) throw new Error(`"${n}" can't be hidden`);
  const s = await load();
  const next = hidden ? [...new Set([...s.hidden, n])] : s.hidden.filter((h) => h !== n);
  await setSetting(KEY, { ...s, hidden: next });
}

async function moveEntries(from: string, to: string) {
  await db().update(transactions).set({ category: to }).where(eq(transactions.category, from));
  // A budget for the new name wins; otherwise the old budget is carried over.
  const [clash] = await db().select().from(budgets).where(eq(budgets.category, to));
  if (clash) await db().delete(budgets).where(eq(budgets.category, from));
  else await db().update(budgets).set({ category: to }).where(eq(budgets.category, from));
  await db()
    .update(favourites)
    .set({ payload: sql`jsonb_set(${favourites.payload}, '{category}', to_jsonb(${to}::text))` })
    .where(sql`${favourites.payload}->>'category' = ${from}`);
}

/** Extra lines for the AI prompt so it uses your own categories. */
export async function categoryHint() {
  const s = await load();
  if (!s.custom.length) return "";
  const ex = s.custom.filter((c) => c.type === "expense").map((c) => c.name);
  const inc = s.custom.filter((c) => c.type === "income").map((c) => c.name);
  const q = (l: string[]) => l.map((n) => JSON.stringify(n)).join(", ");
  return `\nExtra categories the user created (use one ONLY when it clearly matches, else use the normal list):${ex.length ? ` expense ${q(ex)}.` : ""}${inc.length ? ` income ${q(inc)}.` : ""} Category values must be exactly one name, never a label like "expenses: X".`;
}

/**
 * Make sure a category is one the app knows: fixes case, strips stray labels
 * ("expenses: Fuel" → "Fuel"), and falls back to "Other". Transfers keep "Transfer".
 */
export async function normalizeCategory(raw: string | null | undefined, type: "expense" | "income" | "transfer") {
  if (type === "transfer") return "Transfer";
  const s = await load();
  const known = [...DEFAULT_CATEGORIES, ...INCOME_CATEGORIES, ...s.custom.map((c) => c.name), "Refund"];
  const clean = (raw || "").replace(/^\s*(expenses?|income|category)\s*:\s*/i, "").trim();
  return known.find((k) => k.toLowerCase() === clean.toLowerCase()) || "Other";
}
