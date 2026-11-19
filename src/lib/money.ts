import { z } from "zod";

export const DEFAULT_CATEGORIES = [
  "Food",
  "Groceries",
  "Transport",
  "Fuel",
  "Shopping",
  "Bills",
  "Rent",
  "EMI/Loans",
  "Health",
  "Entertainment",
  "Subscriptions",
  "Education",
  "Travel",
  "Family",
  "Gifts",
  "Other",
] as const;

export const INCOME_CATEGORIES = ["Salary", "Freelance", "Refund", "Interest", "Gift", "Other"] as const;

export const METHODS = ["upi", "card", "cash", "bank"] as const;
export const ACCOUNT_KINDS = ["bank", "card", "cash", "wallet"] as const;

export const TOTAL_BUDGET = "__total__";

/** Editable shape of an expense or income entry. `amount` is in rupees. */
export const transactionInputSchema = z.object({
  type: z.enum(["expense", "income", "transfer"]).default("expense"),
  amount: z.coerce.number().positive().max(100_000_000),
  category: z.string().trim().min(1).max(40).default("Other"),
  note: z.string().trim().max(500).nullish(),
  merchant: z.string().trim().max(100).nullish(),
  method: z.enum(METHODS).nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  /** Account/wallet id (optional). For transfers: the "from" account. */
  accountId: z.string().uuid().nullish(),
  /** Transfers only: the account receiving the money. */
  toAccountId: z.string().uuid().nullish(),
});

export type TransactionInput = z.infer<typeof transactionInputSchema>;

export const toPaise = (rupees: number) => Math.round(rupees * 100);
export const toRupees = (paise: number) => paise / 100;

const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₹1,20,000 style. Shows paise only when there are some. */
export function formatINR(paise: number) {
  return paise % 100 === 0 ? inr0.format(paise / 100) : inr2.format(paise / 100);
}

/** Keyword → category guesses used by the offline parser. */
export const CATEGORY_KEYWORDS: [RegExp, string][] = [
  [/\b(salary|payslip|stipend)\b/i, "Salary"],
  [/\b(rent)\b/i, "Rent"],
  [/\b(emi|loan)\b/i, "EMI/Loans"],
  [/\b(petrol|diesel|fuel)\b/i, "Fuel"],
  [/\b(uber|ola|rapido|auto|metro|bus|train|cab|taxi|parking|toll)\b/i, "Transport"],
  [/\b(grocer(y|ies)|vegetables?|fruits?|milk|bigbasket|blinkit|zepto|instamart|dmart)\b/i, "Groceries"],
  [/\b(lunch|dinner|breakfast|snacks?|coffee|tea|chai|zomato|swiggy|restaurant|food|pizza|biryani|candy|sweets?|chocolate|juice|ice ?cream|bakery)\b/i, "Food"],
  [/\b(netflix|spotify|prime|hotstar|youtube premium|subscription|icloud|chatgpt)\b/i, "Subscriptions"],
  [/\b(electricity|water bill|wifi|broadband|internet|recharge|mobile bill|gas bill|bill)\b/i, "Bills"],
  [/\b(doctor|medicine|pharmacy|hospital|medical|gym)\b/i, "Health"],
  [/\b(movie|cinema|concert|game|outing)\b/i, "Entertainment"],
  [/\b(amazon|flipkart|myntra|clothes|shoes|shopping)\b/i, "Shopping"],
  [/\b(course|books?|fees|tuition|exam)\b/i, "Education"],
  [/\b(flight|hotel|trip|travel)\b/i, "Travel"],
  [/\b(gift)\b/i, "Gifts"],
];
