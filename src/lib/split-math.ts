/** Split maths, shared by the server and the split form (no server imports here). */

export const ME = "me";
export const METHODS = ["equal", "amount", "percent", "shares"] as const;
export type Method = (typeof METHODS)[number];

const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * Work out each person's share in paise. Throws a friendly error if it doesn't add up.
 * Rounding: equal / % / shares leftovers go to you (or the first person if you're not in it).
 */
export function computeShares(totalPaise: number, method: Method, people: { person: string; value: number }[]) {
  const names = people.map((p) => p.person);
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw new Error("Someone is in the split twice");
  let shares: number[];
  if (method === "amount") {
    shares = people.map((p) => Math.round(p.value * 100));
    const sum = shares.reduce((a, b) => a + b, 0);
    if (sum !== totalPaise) {
      const diff = totalPaise - sum;
      throw new Error(diff > 0 ? `${inr(diff)} left to assign` : `${inr(-diff)} more than the bill`);
    }
  } else {
    const weights = method === "equal" ? people.map(() => 1) : people.map((p) => p.value);
    const wsum = weights.reduce((a, b) => a + b, 0);
    if (method === "percent" && Math.abs(wsum - 100) > 0.01) throw new Error(`Percentages add up to ${+wsum.toFixed(2)}%, not 100%`);
    if (wsum <= 0) throw new Error("Give at least one person a share");
    shares = weights.map((w) => Math.floor((totalPaise * w) / wsum));
    const left = totalPaise - shares.reduce((a, b) => a + b, 0);
    const meIdx = names.indexOf(ME);
    shares[meIdx >= 0 ? meIdx : 0] += left;
  }
  return people.map((p, i) => ({ person: p.person, value: p.value, sharePaise: shares[i] }));
}

