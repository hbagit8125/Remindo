/** Kinds of savings (client-safe). */
export const SAVING_KINDS = {
  fd: { emoji: "🏦", label: "Fixed deposit", growth: "Interest" },
  rd: { emoji: "🔁", label: "Recurring deposit", growth: "Interest" },
  mutual_fund: { emoji: "📈", label: "Mutual fund / SIP", growth: "Profit" },
  stocks: { emoji: "💹", label: "Stocks", growth: "Profit" },
  gold: { emoji: "🪙", label: "Gold", growth: "Profit" },
  ppf: { emoji: "🛡️", label: "PPF / EPF / NPS", growth: "Interest" },
  savings: { emoji: "🐖", label: "Savings account", growth: "Interest" },
  chit: { emoji: "🤝", label: "Chit fund", growth: "Dividend" },
  crypto: { emoji: "🪙", label: "Crypto", growth: "Profit" },
  other: { emoji: "💰", label: "Other", growth: "Growth" },
} as const;
export type SavingKind = keyof typeof SAVING_KINDS;
export const SAVING_KIND_KEYS = Object.keys(SAVING_KINDS) as [SavingKind, ...SavingKind[]];
/** Kinds whose value goes up and down with the market: "Update value" is the main action. */
export const MARKET_KINDS: SavingKind[] = ["mutual_fund", "stocks", "gold", "crypto"];
