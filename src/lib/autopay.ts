import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, accounts, autopays, autopayRuns, reminders, savings, type Autopay } from "@/db";
import { isoDay } from "./day";
import { formatINR, toPaise } from "./money";
import { fmtLocal, localToUtc } from "./time";

/**
 * SIPs and EMIs: automatic monthly payments.
 *
 * - On the day (from 7am), the payment is recorded from its account by itself:
 *   a SIP moves money into its saving (a transfer), an EMI is spending (EMI/Loans).
 * - The day before, if the account Remindo tracks looks short (or a card's limit is too low),
 *   a reminder goes out at 7pm through your usual channels. It's withdrawn if you top up in time.
 * - EMIs stop by themselves after the last one.
 */

export const autopayInputSchema = z.object({
  kind: z.enum(["sip", "emi"]),
  name: z.string().trim().min(1).max(80),
  amount: z.coerce.number().positive().max(100_000_000),
  /** SIPs can run daily, weekly, monthly or yearly; EMIs are monthly. */
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]).default("monthly"),
  /** monthly/yearly: day of month; weekly: 1 = Monday … 7 = Sunday; daily: ignored. */
  day: z.coerce.number().int().min(1).max(31).default(1),
  month: z.coerce.number().int().min(1).max(12).nullish(),
  accountId: z.string().uuid().nullish(),
  savingId: z.string().uuid().nullish(),
  /** SIP without a saving yet: make one with this name. */
  newSavingName: z.string().trim().max(80).nullish(),
  startDate: isoDay().nullish(),
  totalCount: z.coerce.number().int().min(1).max(600).nullish(),
  paidBefore: z.coerce.number().int().min(0).max(600).default(0),
  loanAmount: z.coerce.number().min(0).max(1_000_000_000).nullish(),
  lender: z.string().trim().max(80).nullish(),
  active: z.boolean().default(true),
});
export type AutopayInput = z.infer<typeof autopayInputSchema>;

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dateOf = (y: number, m: number, day: number) => {
  const yy = y + Math.floor((m - 1) / 12);
  const mm = ((((m - 1) % 12) + 12) % 12) + 1;
  return `${yy}-${pad(mm)}-${pad(Math.min(day, daysIn(yy, mm)))}`;
};
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const localToday = (now = new Date()) => fmtLocal(now, "yyyy-MM-dd");

type Schedule = Pick<Autopay, "day" | "startDate"> & { frequency?: string | null; month?: number | null };

/** ISO weekday of a yyyy-MM-dd date: 1 = Monday … 7 = Sunday. */
const weekday = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** Payment dates from `from` to `to` (inclusive), never before the start date. */
export function dueDates(a: Schedule, from: string, to: string, limit = 1300) {
  const out: string[] = [];
  const start = from > a.startDate ? from : a.startDate;
  const freq = a.frequency || "monthly";
  if (freq === "daily" || freq === "weekly") {
    for (let d = start, i = 0; d <= to && out.length < limit && i < 4000; d = addDays(d, 1), i++) {
      if (freq === "daily" || weekday(d) === a.day) out.push(d);
    }
    return out;
  }
  const [y0, m0] = start.split("-").map(Number);
  if (freq === "yearly") {
    for (let y = y0; out.length < limit && y < y0 + 100; y++) {
      const d = dateOf(y, a.month || 1, a.day);
      if (d > to) break;
      if (d >= start) out.push(d);
    }
    return out;
  }
  let m = m0;
  for (let i = 0; i < 1300 && out.length < limit; i++) {
    const d = dateOf(y0, m, a.day);
    if (d > to) break;
    if (d >= start) out.push(d);
    m++;
  }
  return out;
}

/** The first payment date on or after `after`. */
export function nextDue(a: Schedule, after: string) {
  return dueDates(a, after, addDays(after, 370), 1)[0];
}

/** First payment for a new SIP/EMI: the next time it comes round (today counts). */
export function firstDate(s: Omit<Schedule, "startDate">, today = localToday()) {
  return nextDue({ ...s, startDate: today }, today);
}

/** "Every day", "Every Monday", "5th every month", "Every 15 Mar". */
export function scheduleLabel(a: { frequency?: string | null; day: number; month?: number | null }) {
  const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
  if (a.frequency === "daily") return "Every day";
  if (a.frequency === "weekly") return `Every ${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][a.day - 1] || "week"}`;
  if (a.frequency === "yearly") return `Every ${a.day} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(a.month || 1) - 1]}`;
  return `${ord(a.day)} every month`;
}

// ------------------------------------------------------------- list

export async function listAutopays(today = localToday()) {
  const rows = await db().select().from(autopays).orderBy(asc(autopays.createdAt));
  if (!rows.length) return [];
  const runs = await db()
    .select()
    .from(autopayRuns)
    .where(
      inArray(
        autopayRuns.autopayId,
        rows.map((r) => r.id),
      ),
    );
  const { listAccounts } = await import("./moneyplus");
  const accs = await listAccounts();
  const savingRows = await db().select({ id: savings.id, name: savings.name }).from(savings);
  return rows.map((a) => {
    const mine = runs.filter((r) => r.autopayId === a.id);
    const paid = a.paidBefore + mine.length;
    const done = a.kind === "emi" && a.totalCount !== null && paid >= a.totalCount;
    // The next date that hasn't been paid yet (paying early marks a date as paid).
    const paidDates = new Set(mine.map((r) => r.dueDate));
    const next = done ? null : (dueDates(a, today, addDays(today, 800), 40).find((d) => !paidDates.has(d)) ?? null);
    const acc = accs.find((x) => x.id === a.accountId) ?? null;
    const available = acc ? (acc.kind === "card" ? (acc.card?.availablePaise ?? null) : acc.balancePaise) : null;
    const left = a.kind === "emi" && a.totalCount ? Math.max(0, a.totalCount - paid) : null;
    const lastDate = left ? (dueDates(a, next || today, "9999-12-31", left).at(-1) ?? null) : null;
    return {
      ...a,
      paidCount: paid,
      remainingCount: left,
      remainingPaise: left !== null ? left * a.amountPaise : null,
      endDate: lastDate,
      nextDate: a.active ? next : null,
      lastPaid: mine.map((r) => r.dueDate).sort().at(-1) ?? null,
      accountName: acc?.name ?? null,
      accountKind: acc?.kind ?? null,
      savingName: savingRows.find((s) => s.id === a.savingId)?.name ?? null,
      /** The account looks short for the next payment. */
      short: a.active && next && available !== null && available < a.amountPaise ? a.amountPaise - available : 0,
    };
  });
}

// ------------------------------------------------------------- changes (undoable)

async function rowFrom(d: AutopayInput, existing?: Autopay) {
  let savingId = d.kind === "sip" ? d.savingId || null : null;
  if (d.kind === "sip" && !savingId) {
    const { createSaving } = await import("./savings");
    const s = await createSaving({ name: d.newSavingName || d.name, kind: "mutual_fund" });
    savingId = s.id;
  }
  return {
    kind: d.kind,
    name: d.name,
    amountPaise: toPaise(d.amount),
    frequency: d.kind === "emi" ? "monthly" : d.frequency,
    day: d.kind === "emi" || d.frequency !== "weekly" ? d.day : Math.min(7, d.day),
    month: d.kind === "sip" && d.frequency === "yearly" ? d.month || 1 : null,
    accountId: d.accountId || null,
    savingId,
    // Changing the day moves the next payment; it never goes back and records old ones.
    startDate:
      d.startDate ||
      (existing && existing.frequency === (d.kind === "emi" ? "monthly" : d.frequency) ? existing.startDate : null) ||
      firstDate({ frequency: d.kind === "emi" ? "monthly" : d.frequency, day: d.day, month: d.month }),
    totalCount: d.kind === "emi" ? d.totalCount ?? null : null,
    paidBefore: d.kind === "emi" ? d.paidBefore : 0,
    loanPaise: d.kind === "emi" && d.loanAmount ? toPaise(d.loanAmount) : null,
    lender: d.kind === "emi" ? d.lender || null : null,
    active: d.active,
  };
}

export async function createAutopay(d: AutopayInput) {
  const u = await import("./undo");
  return u.recorded({ title: `Added ${d.kind === "sip" ? "SIP" : "EMI"} ${d.name} ${formatINR(toPaise(d.amount))}`, kind: "add" }, async (rec) => {
    const [a] = await db()
      .insert(autopays)
      .values(await rowFrom(d))
      .returning();
    rec(u.removed("autopays", [a.id]));
    await checkAutopays();
    return a;
  });
}

export async function updateAutopay(id: string, d: AutopayInput) {
  const u = await import("./undo");
  const [cur] = await db().select().from(autopays).where(eq(autopays.id, id));
  if (!cur) return null;
  return u.recorded({ title: `Edited ${cur.kind === "sip" ? "SIP" : "EMI"} ${d.name}`, kind: "edit" }, async (rec) => {
    rec(await u.snap("autopays", [id]));
    const [a] = await db()
      .update(autopays)
      .set(await rowFrom(d, cur))
      .where(eq(autopays.id, id))
      .returning();
    await clearAlert(a);
    await checkAutopays();
    return a;
  });
}

export async function deleteAutopay(id: string) {
  const u = await import("./undo");
  const [cur] = await db().select().from(autopays).where(eq(autopays.id, id));
  if (!cur) return null;
  return u.recorded({ title: `Deleted ${cur.kind === "sip" ? "SIP" : "EMI"} ${cur.name}`, kind: "delete" }, async (rec) => {
    rec({ op: "seq", ops: [(await u.snap("autopays", [id]))!, await u.snapWhere("autopayRuns", "autopayId", id)] });
    await clearAlert(cur);
    await db().delete(autopayRuns).where(eq(autopayRuns.autopayId, id));
    await db().delete(autopays).where(eq(autopays.id, id));
    return cur;
  });
}

async function clearAlert(a: Autopay) {
  if (!a.alertReminderId) return;
  const life = await import("./life");
  await life.deleteReminder(a.alertReminderId);
  await db().update(autopays).set({ alertReminderId: null, alertFor: null }).where(eq(autopays.id, a.id));
}

// ------------------------------------------------------------- the daily work

/** Record one payment (both the money and the run, so it never happens twice). */
/** early.accountId: undefined = the usual account, null = "Other" (an account you don't track). */
async function pay(a: Autopay, dueDate: string, early?: { paidOn: string; accountId?: string | null }) {
  const u = await import("./undo");
  // Claim the date first: if two runs race, only one records the money.
  const [run] = await db().insert(autopayRuns).values({ autopayId: a.id, dueDate }).onConflictDoNothing().returning();
  if (!run) return null;
  const n = a.kind === "emi" ? a.paidBefore + (await db().select().from(autopayRuns).where(eq(autopayRuns.autopayId, a.id))).length : 0;
  const label = a.kind === "sip" ? `SIP ${formatINR(a.amountPaise)} · ${a.name}` : `EMI ${n}${a.totalCount ? `/${a.totalCount}` : ""} ${formatINR(a.amountPaise)} · ${a.name}`;
  const on = early?.paidOn ?? dueDate;
  const { undoId } = await u.track(
    () =>
      u.recorded({ title: `${early ? "Paid early" : "Auto-paid"} ${label}`, kind: "add" }, async (rec) => {
        // Undoing an early payment frees the date again, so it's paid on the day as usual.
        if (early) rec(u.removed("autopayRuns", [run.id]));
        const fromId = early && early.accountId !== undefined ? early.accountId : a.accountId;
        const [acc] = fromId ? await db().select().from(accounts).where(eq(accounts.id, fromId)) : [];
        if (a.kind === "sip" && a.savingId) {
          const { addEntry } = await import("./savings");
          const e = await addEntry(a.savingId, { type: "deposit", amount: a.amountPaise / 100, date: on, note: `${early ? "Paid early · " : ""}SIP · ${fmtLocal(new Date(`${dueDate}T12:00:00Z`), a.frequency === "monthly" ? "MMM yyyy" : a.frequency === "yearly" ? "yyyy" : "d MMM")}`, accountId: acc && acc.kind !== "card" ? acc.id : null });
          await db().update(autopayRuns).set({ savingEntryId: e?.id ?? null, transactionId: e?.transactionId ?? null }).where(eq(autopayRuns.id, run.id));
        } else {
          const { createTransactions } = await import("./create");
          const [tx] = await createTransactions([
            {
              type: "expense",
              amount: a.amountPaise / 100,
              category: "EMI/Loans",
              note: `${a.name} EMI${a.totalCount ? ` ${n}/${a.totalCount}` : ""}${early ? ` (paid early, due ${fmtLocal(new Date(`${dueDate}T12:00:00Z`), "d MMM")})` : ""}`,
              merchant: a.lender || null,
              method: acc?.kind === "card" ? "card" : acc?.kind === "cash" ? "cash" : acc ? "bank" : null,
              date: on,
              accountId: acc?.id ?? null,
            },
          ]);
          await db().update(autopayRuns).set({ transactionId: tx.id }).where(eq(autopayRuns.id, run.id));
        }
        // Last EMI → done (Undo turns it back on).
        if (a.kind === "emi" && a.totalCount && n >= a.totalCount) {
          rec(await u.snap("autopays", [a.id]));
          await db().update(autopays).set({ active: false }).where(eq(autopays.id, a.id));
        }
      }),
    { via: "app" },
  );

  return { label, undoId, account: a.accountId };
}

/**
 * "Paid early": record the next unpaid payment now (or on the day you say). That due date is
 * then done, so the automatic payment skips it, and no low-balance reminder comes for it.
 */
export async function payEarly(id: string, paidOn?: string | null, now = new Date(), accountId?: string | null) {
  const [a] = await db().select().from(autopays).where(eq(autopays.id, id));
  if (!a) throw new Error("Not found");
  const today = localToday(now);
  const item = (await listAutopays(today)).find((x) => x.id === id);
  const due = item?.nextDate ?? null;
  if (!a.active || !due) throw new Error(a.kind === "emi" && item?.remainingCount === 0 ? "All EMIs are already paid" : "Nothing left to pay (it's paused or finished)");
  const on = paidOn && paidOn <= today ? paidOn : today;
  if (a.alertFor === due) await clearAlert(a);
  const r = await pay(a, due, { paidOn: on, accountId });
  if (!r) throw new Error("That payment is already recorded");
  return { ...r, dueDate: due };
}

/** Make today's payments (catching up on missed days since it was added) once it's 7am or later. */
export async function runAutopays(now = new Date()) {
  const hour = Number(fmtLocal(now, "H"));
  if (hour < 7) return [];
  const today = localToday(now);
  const rows = await db().select().from(autopays).where(eq(autopays.active, true));
  const done: { label: string; undoId: string | null; account: string | null }[] = [];
  for (const a of rows) {
    const added = fmtLocal(a.createdAt, "yyyy-MM-dd");
    const from = added > a.startDate ? added : a.startDate;
    // At most the last 3 missed payments (e.g. the app was asleep), never older ones.
    for (const d of dueDates(a, from, today).slice(-3)) {
      const r = await pay(a, d);
      if (r) done.push(r);
      const [still] = await db().select({ active: autopays.active }).from(autopays).where(eq(autopays.id, a.id));
      if (!still?.active) break;
    }
    if (a.alertReminderId && a.alertFor && a.alertFor <= today) {
      const [fresh] = await db().select().from(autopays).where(eq(autopays.id, a.id));
      if (fresh) await clearAlertIfPast(fresh, today);
    }
  }
  if (done.length) await tellPaid(done);
  return done;
}

async function clearAlertIfPast(a: Autopay, today: string) {
  if (!a.alertReminderId || !a.alertFor || a.alertFor > today) return;
  // Payment day has come: the "top up" reminder has done its job.
  await db().update(autopays).set({ alertReminderId: null, alertFor: null }).where(eq(autopays.id, a.id));
}

/** "💸 Auto-paid: …" on Telegram with an Undo button (in case the bank didn't take it). */
async function tellPaid(done: { label: string; undoId: string | null }[]) {
  const { sendTelegram, h } = await import("./telegram");
  for (const d of done) {
    await sendTelegram(`💸 <b>Auto-paid</b>: ${h(d.label)}\n<i>Didn't go through? Tap Undo.</i>`, d.undoId ? [[{ text: "↩️ Undo", callback_data: `u:${d.undoId}` }]] : undefined).catch(() => null);
  }
}

/**
 * The day before a payment: if the account looks short, remind at 7pm with how much to add.
 * Run often (sweep): it also withdraws the reminder once there's enough.
 */
export async function checkAutopays(now = new Date()) {
  const today = localToday(now);
  const tomorrow = addDays(today, 1);
  const list = await listAutopays(today);
  const byAccount = new Map<string, { a: (typeof list)[number]; amount: number }[]>();
  for (const a of list) {
    if (!a.active || !a.accountId || a.nextDate !== tomorrow) continue;
    byAccount.set(a.accountId, [...(byAccount.get(a.accountId) || []), { a, amount: a.amountPaise }]);
  }
  const { listAccounts } = await import("./moneyplus");
  const accs = await listAccounts();
  const life = await import("./life");
  const made: string[] = [];
  for (const [accountId, items] of byAccount) {
    const acc = accs.find((x) => x.id === accountId);
    if (!acc) continue;
    const need = items.reduce((t, i) => t + i.amount, 0);
    const have = acc.kind === "card" ? (acc.card?.availablePaise ?? Infinity) : acc.balancePaise;
    const short = need - have;
    for (const { a } of items) {
      const [row] = await db().select().from(autopays).where(eq(autopays.id, a.id));
      if (short <= 0) {
        // Enough money now: withdraw a pending top-up reminder.
        if (row?.alertReminderId && row.alertFor === tomorrow) {
          await life.deleteReminder(row.alertReminderId);
          await db().update(autopays).set({ alertReminderId: null, alertFor: null }).where(eq(autopays.id, a.id));
        }
        continue;
      }
      if (row?.alertFor === tomorrow && row.alertReminderId) {
        // Keep the amount up to date.
        await db().update(reminders).set({ amountPaise: short, updatedAt: new Date() }).where(eq(reminders.id, row.alertReminderId));
        continue;
      }
      // One reminder per account per day, listing everything due from it.
      if (made.includes(accountId)) continue;
      const what = items.map((i) => `${i.a.kind === "sip" ? "SIP" : "EMI"} ${i.a.name} ${formatINR(i.amount)}`).join(" + ");
      const at = localToUtc(today, "19:00");
      const time = now > at ? fmtLocal(new Date(now.getTime() + 10 * 60000), "HH:mm") : "19:00";
      if (time < "07:00" || (now > at && Number(fmtLocal(now, "H")) >= 23)) continue; // too late tonight; nothing useful to do
      const id = await life.upsertReminder(
        null,
        {
          title: `Add ${formatINR(short)} to ${acc.name} for tomorrow's ${items.length > 1 ? "payments" : items[0].a.kind === "sip" ? "SIP" : "EMI"}`,
          notes: `${acc.kind === "card" ? `${acc.name} has ${formatINR(Math.max(0, have))} of limit left` : `${acc.name} has ${formatINR(have)}`}. Tomorrow: ${what}.`,
          date: today,
          time,
          recurrence: "none",
          interval: 1,
          priority: "high",
          category: "money",
          leadTimes: [0],
        },
        { kind: "autopay-alert", id: accountId },
      );
      for (const i of items) await db().update(autopays).set({ alertReminderId: id, alertFor: tomorrow }).where(eq(autopays.id, i.a.id));
      made.push(accountId);
    }
  }
  return { alerts: made.length };
}

export async function autopayTick(now = new Date()) {
  const paid = await runAutopays(now).catch((e) => (console.error("[remindo:autopay]", e), []));
  // FD/RD/PPF interest that has come due (from 7am, like payments).
  const interest = Number(fmtLocal(now, "H")) >= 7 ? await import("./savings").then((m) => m.creditInterest(now)).catch((e) => (console.error("[remindo:interest]", e), [])) : [];
  const check = await checkAutopays(now).catch((e) => (console.error("[remindo:autopay]", e), { alerts: 0 }));
  return { paid: paid.length, interest: interest.length, ...check };
}

