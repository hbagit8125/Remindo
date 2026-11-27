import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, savings, savingEntries, transactions, type Saving, type SavingEntry } from "@/db";
import { isoDay } from "./day";
import { toPaise } from "./money";
import { fmtLocal } from "./time";
import { SAVING_KIND_KEYS, SAVING_KINDS, type SavingKind } from "./savings-kinds";

/**
 * Savings & investments. Value = money put in − taken out + growth (interest, profit, dividends;
 * a loss is negative growth). For market investments you can just type today's value and the
 * difference is recorded as profit or loss.
 */

export const savingInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(SAVING_KIND_KEYS).default("other"),
  institution: z.string().trim().max(80).nullish(),
  ratePct: z.coerce.number().min(0).max(100).nullish(),
  maturityDate: isoDay().nullish(),
  notes: z.string().trim().max(1000).nullish(),
  /** Add interest by itself at ratePct (FD, RD, PPF, savings account…). */
  interestFreq: z.enum(["monthly", "quarterly", "halfyearly", "yearly"]).nullish(),
  /** Paid out to this account (non-cumulative FD) instead of staying in. */
  interestAccountId: z.string().uuid().nullish(),
  /** Interest dates count from here (e.g. when the FD was opened). Default: today. */
  interestFrom: isoDay().nullish(),
  /** New only: what's in it today (counted as money you put in). */
  startAmount: z.coerce.number().min(0).max(1_000_000_000).nullish(),
  /** New only: the account that money came from (makes a transfer). */
  fromAccountId: z.string().uuid().nullish(),
});
export type SavingInput = z.infer<typeof savingInputSchema>;

export const entryInputSchema = z.object({
  /** value = "it's worth this much now" → the difference becomes profit/loss. */
  type: z.enum(["deposit", "withdraw", "growth", "value"]),
  amount: z.coerce.number().min(0).max(1_000_000_000),
  /** growth only: true = a loss. */
  loss: z.boolean().optional(),
  date: isoDay(),
  note: z.string().trim().max(200).nullish(),
  /** deposit: paid from this account; withdraw: money went to this account. */
  accountId: z.string().uuid().nullish(),
});
export type EntryInput = z.infer<typeof entryInputSchema>;

const today = () => fmtLocal(new Date(), "yyyy-MM-dd");

export type SavingTotals = { inPaise: number; outPaise: number; growthPaise: number; valuePaise: number; investedPaise: number; returnPct: number | null };

export function totals(entries: Pick<SavingEntry, "type" | "amountPaise">[]): SavingTotals {
  let inP = 0,
    outP = 0,
    growth = 0;
  for (const e of entries) {
    if (e.type === "deposit") inP += e.amountPaise;
    else if (e.type === "withdraw") outP += e.amountPaise;
    else if (e.type === "growth") growth += e.amountPaise;
  }
  const invested = inP - outP;
  return {
    inPaise: inP,
    outPaise: outP,
    growthPaise: growth,
    valuePaise: invested + growth,
    investedPaise: invested,
    returnPct: invested > 0 ? Math.round((growth / invested) * 1000) / 10 : null,
  };
}

/** Every saving with its totals, plus the overall picture. */
export async function listSavings() {
  const rows = await db().select().from(savings).where(eq(savings.archived, false)).orderBy(asc(savings.createdAt));
  const entries = rows.length
    ? await db()
        .select()
        .from(savingEntries)
        .where(
          inArray(
            savingEntries.savingId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  const yearStart = `${today().slice(0, 4)}-01-01`;
  const list = rows.map((s) => {
    const mine = entries.filter((e) => e.savingId === s.id);
    const last = mine.reduce((m, e) => (e.date > m ? e.date : m), "");
    const tot = totals(mine);
    return { ...s, ...tot, lastDate: last || null, entryCount: mine.length, nextInterest: nextInterest(s, tot.valuePaise) };
  });
  const all = totals(entries.filter((e) => list.some((s) => s.id === e.savingId)));
  const earnedThisYear = entries.filter((e) => e.type === "growth" && e.date >= yearStart && list.some((s) => s.id === e.savingId)).reduce((t, e) => t + e.amountPaise, 0);
  return { savings: list, total: { ...all, earnedThisYear } };
}

export async function getSaving(id: string) {
  const [s] = await db().select().from(savings).where(eq(savings.id, id));
  if (!s) return null;
  const entries = await db().select().from(savingEntries).where(eq(savingEntries.savingId, id)).orderBy(desc(savingEntries.date), desc(savingEntries.createdAt));
  const tot = totals(entries);
  return { ...s, ...tot, entries, nextInterest: nextInterest(s, tot.valuePaise) };
}

// ------------------------------------------------------------- maturity reminder

async function syncMaturity(s: Saving) {
  const life = await import("./life");
  if (!s.maturityDate || s.archived || s.maturityDate < today()) {
    if (s.reminderId) {
      await life.deleteReminder(s.reminderId);
      await db().update(savings).set({ reminderId: null }).where(eq(savings.id, s.id));
    }
    return;
  }
  const id = await life.upsertReminder(
    s.reminderId,
    {
      title: `${s.name} matures`,
      notes: `${SAVING_KINDS[s.kind as SavingKind]?.label || "Saving"}${s.institution ? ` at ${s.institution}` : ""}. Decide whether to renew or withdraw, then update it in Money → Savings.`,
      date: s.maturityDate,
      time: "10:00",
      recurrence: "none",
      interval: 1,
      priority: "normal",
      category: "money",
      leadTimes: [60 * 24 * 7, 60 * 24, 0],
    },
    { kind: "saving", id: s.id },
  );
  if (id !== s.reminderId) await db().update(savings).set({ reminderId: id }).where(eq(savings.id, s.id));
}

// ------------------------------------------------------------- changes (all undoable)

function row(d: SavingInput) {
  return {
    name: d.name,
    kind: d.kind,
    institution: d.institution || null,
    ratePct: d.ratePct != null ? String(d.ratePct) : null,
    maturityDate: d.maturityDate || null,
    notes: d.notes || null,
    interestFreq: d.interestFreq && d.ratePct ? d.interestFreq : null,
    interestAccountId: d.interestFreq && d.ratePct ? d.interestAccountId || null : null,
    interestFrom: d.interestFreq && d.ratePct ? d.interestFrom || today() : null,
  };
}

export async function createSaving(d: SavingInput) {
  const u = await import("./undo");
  return u.recorded({ title: `Added saving “${d.name}”`, kind: "add" }, async (rec) => {
    // Interest is only ever added from today on (what's in it today already includes the past).
    const [s] = await db()
      .insert(savings)
      .values({ ...row(d), lastInterestDate: d.interestFreq ? today() : null })
      .returning();
    rec(u.removed("savings", [s.id]));
    if (d.startAmount) await addEntryInner(s, { type: "deposit", amount: d.startAmount, date: today(), note: "Starting amount", accountId: d.fromAccountId }, rec);
    await syncMaturity(s);
    return s;
  });
}

export async function updateSaving(id: string, d: SavingInput) {
  const u = await import("./undo");
  return u.recorded({ title: `Edited ${d.name}`, kind: "edit" }, async (rec) => {
    rec(await u.snap("savings", [id]));
    const [cur] = await db().select().from(savings).where(eq(savings.id, id));
    const next = row(d);
    // Turning interest on (or changing how it's counted) starts from today: no back-dated interest.
    const changed = next.interestFreq && (next.interestFreq !== cur?.interestFreq || next.interestFrom !== cur?.interestFrom || next.ratePct !== cur?.ratePct);
    const [s] = await db()
      .update(savings)
      .set({ ...next, ...(changed ? { lastInterestDate: today() } : {}) })
      .where(eq(savings.id, id))
      .returning();
    if (s) await syncMaturity(s);
    return s ?? null;
  });
}

/** Delete a saving with its history (Undo brings it all back). Bank transfers it made stay. */
export async function deleteSaving(id: string) {
  const u = await import("./undo");
  const [s] = await db().select().from(savings).where(eq(savings.id, id));
  if (!s) return null;
  return u.recorded({ title: `Deleted ${s.name}`, kind: "delete" }, async (rec) => {
    rec({ op: "seq", ops: [(await u.snap("savings", [id]))!, await u.snapWhere("savingEntries", "savingId", id)] });
    await db().delete(savingEntries).where(eq(savingEntries.savingId, id));
    await db().delete(savings).where(eq(savings.id, id));
    await syncMaturity({ ...s, archived: true });
    return s;
  });
}

const entryTitle = (s: Saving, type: string, paise: number, label: string) => {
  const amt = `₹${(Math.abs(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  if (type === "deposit") return `Added ${amt} to ${s.name}`;
  if (type === "withdraw") return `Took ${amt} out of ${s.name}`;
  return paise < 0 ? `Loss ${amt} on ${s.name}` : `${label} ${amt} on ${s.name}`;
};

export async function addEntry(savingId: string, e: EntryInput) {
  const u = await import("./undo");
  const [s] = await db().select().from(savings).where(eq(savings.id, savingId));
  if (!s) return null;
  return u.recorded({ title: (x: SavingEntry | null) => (x ? entryTitle(s, x.type, x.amountPaise, SAVING_KINDS[s.kind as SavingKind]?.growth || "Growth") : null), kind: "add" }, (rec) =>
    addEntryInner(s, e, rec),
  );
}

async function addEntryInner(s: Saving, e: EntryInput, rec: (op: import("./undo").Op | null) => void): Promise<SavingEntry | null> {
  const u = await import("./undo");
  let type: string = e.type;
  let paise = toPaise(e.amount);
  if (e.type === "value") {
    // "It's worth ₹X now" → the change since the last value is profit or loss.
    const cur = totals(await db().select().from(savingEntries).where(eq(savingEntries.savingId, s.id)));
    paise = paise - cur.valuePaise;
    type = "growth";
    if (!paise) return null;
  } else if (e.type === "growth" && e.loss) paise = -paise;
  if (!paise) return null;
  if (type === "withdraw") {
    const cur = totals(await db().select().from(savingEntries).where(eq(savingEntries.savingId, s.id)));
    if (paise > cur.valuePaise) throw new Error(`Only ₹${(cur.valuePaise / 100).toLocaleString("en-IN")} is in ${s.name}`);
  }
  // Money moving between your bank and the saving is a transfer, never spending or income.
  let transactionId: string | null = null;
  if (e.accountId && (type === "deposit" || type === "withdraw")) {
    const { createTransactions } = await import("./create");
    const [tx] = await createTransactions([
      {
        type: "transfer",
        amount: Math.abs(paise) / 100,
        category: "Transfer",
        note: type === "deposit" ? `To ${s.name}` : `From ${s.name}`,
        date: e.date,
        accountId: type === "deposit" ? e.accountId : null,
        toAccountId: type === "withdraw" ? e.accountId : null,
      },
    ]);
    transactionId = tx.id;
  }
  const [row] = await db()
    .insert(savingEntries)
    .values({ savingId: s.id, type, amountPaise: paise, date: e.date, note: e.note || (e.type === "value" ? "Value updated" : null), transactionId })
    .returning();
  rec(u.removed("savingEntries", [row.id]));
  return row;
}

/** Remove one history line (and the bank transfer it made). */
export async function deleteEntry(id: string) {
  const u = await import("./undo");
  const [e] = await db().select().from(savingEntries).where(eq(savingEntries.id, id));
  if (!e) return null;
  return u.recorded({ title: "Removed a savings entry", kind: "delete" }, async (rec) => {
    rec(await u.snap("savingEntries", [id]));
    if (e.transactionId) {
      rec(await u.snap("transactions", [e.transactionId]));
      await db().delete(transactions).where(eq(transactions.id, e.transactionId));
    }
    await db().delete(savingEntries).where(and(eq(savingEntries.id, id)));
    return e;
  });
}

// ------------------------------------------------------------- interest added by itself

export const INTEREST_MONTHS = { monthly: 1, quarterly: 3, halfyearly: 6, yearly: 12 } as const;

const addMonths = (d: string, n: number, dayOfMonth: number) => {
  const [y, m] = d.split("-").map(Number);
  const yy = y + Math.floor((m - 1 + n) / 12);
  const mm = ((((m - 1 + n) % 12) + 12) % 12) + 1;
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return `${yy}-${String(mm).padStart(2, "0")}-${String(Math.min(dayOfMonth, last)).padStart(2, "0")}`;
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

/**
 * The interest dates (and the share of a year each covers) after `after` up to `upTo`:
 * every 1/3/6/12 months from `from`, plus a part-period on the maturity date.
 */
export function interestDates(s: { interestFreq: string; interestFrom: string; maturityDate?: string | null }, after: string, upTo: string) {
  const n = INTEREST_MONTHS[s.interestFreq as keyof typeof INTEREST_MONTHS] || 12;
  const day = Number(s.interestFrom.slice(8, 10));
  const end = s.maturityDate && s.maturityDate < upTo ? s.maturityDate : upTo;
  const out: { date: string; years: number }[] = [];
  let prev = s.interestFrom;
  for (let k = 1; k < 1200; k++) {
    const d = addMonths(s.interestFrom, n * k, day);
    if (d > end) break;
    if (d > after) out.push({ date: d, years: n / 12 });
    prev = d;
  }
  // Matures between interest dates: the last bit, day by day.
  if (s.maturityDate && s.maturityDate <= upTo && s.maturityDate > prev && s.maturityDate > after) out.push({ date: s.maturityDate, years: daysBetween(prev, s.maturityDate) / 365 });
  return out;
}

/** Add interest that has come due (in the daily job). Returns lines like "Interest ₹1,850 · SBI FD". */
export async function creditInterest(now = new Date()) {
  const u = await import("./undo");
  const t = fmtLocal(now, "yyyy-MM-dd");
  const rows = await db().select().from(savings).where(eq(savings.archived, false));
  const done: { label: string; undoId: string | null }[] = [];
  for (const s of rows) {
    const rate = Number(s.ratePct);
    if (!s.interestFreq || !rate || !s.interestFrom) continue;
    const after = s.lastInterestDate || t;
    for (const { date, years } of interestDates({ interestFreq: s.interestFreq, interestFrom: s.interestFrom, maturityDate: s.maturityDate }, after, t).slice(0, 12)) {
      // Claim the date first so two runs can't both add it.
      const [claimed] = await db()
        .update(savings)
        .set({ lastInterestDate: date })
        .where(and(eq(savings.id, s.id), s.lastInterestDate ? eq(savings.lastInterestDate, s.lastInterestDate) : eq(savings.id, s.id)))
        .returning();
      if (!claimed) break;
      s.lastInterestDate = date;
      const entries = await db().select().from(savingEntries).where(eq(savingEntries.savingId, s.id));
      const value = totals(entries.filter((e) => e.date <= date)).valuePaise;
      const paise = Math.round((value * rate * years) / 100);
      if (paise <= 0) continue;
      const label = `Interest ₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })} · ${s.name}${s.interestAccountId ? " (paid out)" : ""}`;
      const { undoId } = await u.track(
        () =>
          u.recorded({ title: label, kind: "add" }, async (rec) => {
            await addEntryInner(s, { type: "growth", amount: paise / 100, date, note: `Interest at ${rate}%` }, rec);
            // Non-cumulative: the interest goes straight to your bank.
            if (s.interestAccountId) await addEntryInner(s, { type: "withdraw", amount: paise / 100, date, note: "Interest paid out", accountId: s.interestAccountId }, rec);
          }),
        { via: "app" },
      );
      done.push({ label, undoId });
    }
  }
  if (done.length) {
    const { sendTelegram, h } = await import("./telegram");
    for (const d of done) await sendTelegram(`📈 <b>${h(d.label)}</b>`, d.undoId ? [[{ text: "↩️ Undo", callback_data: `u:${d.undoId}` }]] : undefined).catch(() => null);
  }
  return done;
}

/** The next interest date and a rough amount, for the saving's page. */
export function nextInterest(s: Pick<Saving, "interestFreq" | "interestFrom" | "maturityDate" | "ratePct" | "lastInterestDate">, valuePaise: number, t = today()) {
  if (!s.interestFreq || !s.interestFrom || !Number(s.ratePct)) return null;
  const next = interestDates({ interestFreq: s.interestFreq, interestFrom: s.interestFrom, maturityDate: s.maturityDate }, s.lastInterestDate && s.lastInterestDate > t ? s.lastInterestDate : t, "9999-12-31")[0];
  if (!next) return null;
  return { date: next.date, paise: Math.round((valuePaise * Number(s.ratePct) * next.years) / 100) };
}
