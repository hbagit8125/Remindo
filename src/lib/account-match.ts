import type { TransactionInput } from "./money";

type Acc = { id: string; name: string; kind: string };

// Words in account names that don't tell cards apart ("HDFC card" vs "SBI card").
const GENERIC = new Set(["card", "credit", "debit", "bank", "account", "acc", "savings", "saving", "salary", "wallet", "the", "my", "and", "cash", "current"]);

/** Which of your accounts a message mentions: "lunch 200 on HDFC card", "petrol 1500 from SBI", "cash 50 tea". */
export function matchAccount(text: string, accounts: Acc[]): { accountId: string | null; method: TransactionInput["method"] } {
  const t = ` ${text.toLowerCase()} `;
  const has = (w: string) => new RegExp(`[^a-z0-9]${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^a-z0-9]`).test(t);
  const saysCard = /\b(credit ?card|card)\b/.test(t);
  let best: { a: Acc; score: number } | null = null;
  let tie = false;
  for (const a of accounts) {
    const words = a.name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 2 && !GENERIC.has(w));
    const hits = words.filter(has).length;
    if (!hits) continue;
    const score = hits * 2 + (saysCard && a.kind === "card" ? 1 : 0) + (!saysCard && a.kind !== "card" ? 0.5 : 0);
    if (!best || score > best.score) {
      best = { a, score };
      tie = false;
    } else if (score === best.score) tie = true;
  }
  if (!best && /\bcash\b/.test(t)) {
    const cash = accounts.find((a) => a.kind === "cash");
    return { accountId: cash?.id ?? null, method: "cash" };
  }
  // Only one credit card and the message says "credit card": that's the one.
  if (!best && /\bcredit ?card\b/.test(t)) {
    const cards = accounts.filter((a) => a.kind === "card");
    if (cards.length === 1) return { accountId: cards[0].id, method: "card" };
  }
  const method = methodFrom(t);
  if (!best || tie) return { accountId: null, method };
  const a = best.a;
  return { accountId: a.id, method: a.kind === "card" ? "card" : a.kind === "cash" ? "cash" : method || (a.kind === "bank" ? "upi" : "upi") };
}

function methodFrom(t: string): TransactionInput["method"] {
  if (/\b(upi|gpay|google pay|phonepe|phone pe|paytm|bhim)\b/.test(t)) return "upi";
  if (/\b(net ?banking|neft|imps|rtgs)\b/.test(t)) return "bank";
  if (/\b(card|swiped?)\b/.test(t)) return "card";
  if (/\bcash\b/.test(t)) return "cash";
  return null;
}

/** Fill in the account and UPI/card for parsed entries that don't have one yet. */
export function attachAccounts<T extends { transactions: TransactionInput[] }>(r: T, text: string, accounts: Acc[]): T {
  if (!r.transactions.length) return r;
  // With several entries in one message, only fill when there's one entry (the mention is about it).
  if (r.transactions.length > 1) return r;
  const m = matchAccount(text, accounts);
  return {
    ...r,
    transactions: r.transactions.map((tx) =>
      tx.type === "transfer"
        ? tx
        : { ...tx, accountId: tx.accountId || m.accountId, method: tx.type === "expense" ? tx.method || m.method || null : tx.method },
    ),
  };
}
