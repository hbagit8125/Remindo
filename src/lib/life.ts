import { isoDay } from "./day";
import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import { db, documents, lists, listItems, medicines, people, reminders, type Reminder } from "@/db";
import { inputToRow, type ReminderInput } from "./reminder-input";
import { cancelQueued, planAndQueue } from "./scheduler";
import { createTransactions } from "./create";
import { fmtLocal } from "./time";
import { formatINR, toPaise } from "./money";

const day = isoDay();
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const monthDay = z
  .string()
  .regex(/^\d{2}-\d{2}$/, "use MM-DD")
  .refine((v) => {
    const [m, d] = v.split("-").map(Number);
    return m >= 1 && m <= 12 && d >= 1 && d <= DAYS_IN_MONTH[m - 1];
  }, "That date doesn't exist");

/** Create or replace the reminder behind a document/person/medicine. */
async function upsertReminder(id: string | null, input: ReminderInput, meta?: Record<string, unknown>) {
  if (id) {
    const [existing] = await db().select().from(reminders).where(eq(reminders.id, id));
    if (existing) {
      await cancelQueued(id);
      await db()
        .update(reminders)
        .set({ ...inputToRow(input), meta: meta ?? existing.meta, status: "active", version: sql`${reminders.version} + 1`, updatedAt: new Date() })
        .where(eq(reminders.id, id));
      await planAndQueue({ reminderIds: [id] });
      return id;
    }
  }
  const [r] = await db()
    .insert(reminders)
    .values({ ...inputToRow(input), meta: meta ?? null })
    .returning();
  await planAndQueue({ reminderIds: [r.id] });
  return r.id;
}

async function deleteReminder(id: string | null) {
  if (!id) return;
  await cancelQueued(id);
  await db().delete(reminders).where(eq(reminders.id, id));
}

// ------------------------------------------------------------- documents & renewals

export const DOC_KINDS = ["vehicle_insurance", "puc", "licence", "passport", "health_insurance", "rc", "subscription", "other"] as const;
/** Which money category a renewal is filed under. */
const RENEWAL_CATEGORY: Record<string, string> = {
  vehicle_insurance: "Transport",
  puc: "Transport",
  licence: "Transport",
  rc: "Transport",
  health_insurance: "Health",
  subscription: "Subscriptions",
  passport: "Travel",
};

export const documentInputSchema = z.object({
  kind: z.enum(DOC_KINDS).default("other"),
  name: z.string().trim().min(1).max(80),
  number: z.string().trim().max(60).nullish(),
  expiryDate: day,
  renewalCost: z.coerce.number().min(0).max(100_000_000).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});
export type DocumentInput = z.infer<typeof documentInputSchema>;

function docReminder(d: DocumentInput): ReminderInput {
  return {
    title: `Renew ${d.name}`,
    notes: [d.number && `No. ${d.number}`, d.notes].filter(Boolean).join(" · ") || null,
    date: d.expiryDate,
    time: null,
    recurrence: "none",
    interval: 1,
    priority: "high",
    category: "documents",
    amount: d.renewalCost || null,
    // 30 days, 7 days, 1 day before, and on the day.
    leadTimes: [43200, 10080, 1440, 0],
  };
}

export async function saveDocument(input: DocumentInput, id?: string) {
  const values = {
    kind: input.kind,
    name: input.name,
    number: input.number || null,
    expiryDate: input.expiryDate,
    renewalCostPaise: input.renewalCost ? toPaise(input.renewalCost) : null,
    notes: input.notes || null,
    updatedAt: new Date(),
  };
  if (id) {
    const [cur] = await db().select().from(documents).where(eq(documents.id, id));
    if (!cur) return null;
    const reminderId = await upsertReminder(cur.reminderId, docReminder(input), { kind: "document", id });
    const [d] = await db().update(documents).set({ ...values, reminderId }).where(eq(documents.id, id)).returning();
    return d;
  }
  const [d] = await db().insert(documents).values(values).returning();
  const reminderId = await upsertReminder(null, docReminder(input), { kind: "document", id: d.id });
  const [withR] = await db().update(documents).set({ reminderId }).where(eq(documents.id, d.id)).returning();
  return withR;
}

/** Renewed: new expiry date, and optionally log what it cost. */
export async function renewDocument(id: string, newExpiry: string, cost: number | null, now = new Date()) {
  const [cur] = await db().select().from(documents).where(eq(documents.id, id));
  if (!cur) return null;
  const d = await saveDocument(
    { kind: cur.kind as DocumentInput["kind"], name: cur.name, number: cur.number, expiryDate: newExpiry, renewalCost: cost ?? (cur.renewalCostPaise ? cur.renewalCostPaise / 100 : null), notes: cur.notes },
    id,
  );
  if (cost && cost > 0) {
    await createTransactions([
      { type: "expense", amount: cost, category: RENEWAL_CATEGORY[cur.kind] || "Bills", note: `Renewed ${cur.name}`, date: fmtLocal(now, "yyyy-MM-dd") },
    ]);
  }
  return d;
}

export async function listDocuments() {
  return db().select().from(documents).orderBy(asc(documents.expiryDate));
}

export async function deleteDocument(id: string) {
  const [d] = await db().select().from(documents).where(eq(documents.id, id));
  if (!d) return;
  await deleteReminder(d.reminderId);
  await db().delete(documents).where(eq(documents.id, id));
}

// ------------------------------------------------------------- people

export const personInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  relation: z.string().trim().max(40).nullish(),
  birthday: monthDay.nullish(),
  birthYear: z.coerce.number().int().min(1900).max(2100).nullish(),
  anniversary: monthDay.nullish(),
  giftBudget: z.coerce.number().min(0).max(10_000_000).nullish(),
  giftIdeas: z.string().trim().max(1000).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});
export type PersonInput = z.infer<typeof personInputSchema>;

/** Next date (YYYY-MM-DD) for an MM-DD, today included. Feb 29 → Feb 28 in other years. */
export function nextDate(md: string, now = new Date()) {
  const today = fmtLocal(now, "yyyy-MM-dd");
  const y = Number(today.slice(0, 4));
  const fix = (yy: number) => (md === "02-29" && !(yy % 4 === 0 && (yy % 100 !== 0 || yy % 400 === 0)) ? "02-28" : md);
  const thisYear = `${y}-${fix(y)}`;
  return thisYear >= today ? thisYear : `${y + 1}-${fix(y + 1)}`;
}

function personReminder(p: PersonInput, which: "birthday" | "anniversary", now: Date): ReminderInput {
  const md = which === "birthday" ? p.birthday! : p.anniversary!;
  const gift = [p.giftBudget ? `Gift budget ${formatINR(toPaise(p.giftBudget))}` : null, p.giftIdeas ? `Ideas: ${p.giftIdeas}` : null].filter(Boolean).join(" · ");
  return {
    title: which === "birthday" ? `🎂 ${p.name}'s birthday` : `💍 ${p.name} anniversary`,
    notes: gift || null,
    date: nextDate(md, now),
    time: null,
    recurrence: "yearly",
    interval: 1,
    priority: "high",
    category: "family",
    leadTimes: [10080, 1440, 0],
  };
}

export async function savePerson(input: PersonInput, id?: string, now = new Date()) {
  const cur = id ? (await db().select().from(people).where(eq(people.id, id)))[0] : null;
  if (id && !cur) return null;
  const bId = input.birthday ? await upsertReminder(cur?.birthdayReminderId ?? null, personReminder(input, "birthday", now), { kind: "person" }) : null;
  if (!input.birthday) await deleteReminder(cur?.birthdayReminderId ?? null);
  const aId = input.anniversary ? await upsertReminder(cur?.anniversaryReminderId ?? null, personReminder(input, "anniversary", now), { kind: "person" }) : null;
  if (!input.anniversary) await deleteReminder(cur?.anniversaryReminderId ?? null);
  const values = {
    name: input.name,
    relation: input.relation || null,
    birthday: input.birthday || null,
    birthYear: input.birthYear || null,
    anniversary: input.anniversary || null,
    giftBudgetPaise: input.giftBudget ? toPaise(input.giftBudget) : null,
    giftIdeas: input.giftIdeas || null,
    notes: input.notes || null,
    birthdayReminderId: bId,
    anniversaryReminderId: aId,
  };
  const [row] = id
    ? await db().update(people).set(values).where(eq(people.id, id)).returning()
    : await db().insert(people).values(values).returning();
  return row;
}

export async function listPeople(now = new Date()) {
  const rows = await db().select().from(people).orderBy(asc(people.name));
  const today = fmtLocal(now, "yyyy-MM-dd");
  const daysUntil = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return rows
    .map((p) => {
      const nb = p.birthday ? nextDate(p.birthday, now) : null;
      const na = p.anniversary ? nextDate(p.anniversary, now) : null;
      return {
        ...p,
        nextBirthday: nb,
        daysToBirthday: nb ? daysUntil(nb) : null,
        turning: nb && p.birthYear ? Number(nb.slice(0, 4)) - p.birthYear : null,
        nextAnniversary: na,
        daysToAnniversary: na ? daysUntil(na) : null,
      };
    })
    .sort((a, b) => Math.min(a.daysToBirthday ?? 999, a.daysToAnniversary ?? 999) - Math.min(b.daysToBirthday ?? 999, b.daysToAnniversary ?? 999));
}

export async function deletePerson(id: string) {
  const [p] = await db().select().from(people).where(eq(people.id, id));
  if (!p) return;
  await deleteReminder(p.birthdayReminderId);
  await deleteReminder(p.anniversaryReminderId);
  await db().delete(people).where(eq(people.id, id));
}

// ------------------------------------------------------------- medicines

export const medicineInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  dose: z.string().trim().max(60).nullish(),
  times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1).max(6),
  stock: z.coerce.number().int().min(0).max(10000).nullish(),
  perDose: z.coerce.number().int().min(1).max(20).default(1),
  refillAt: z.coerce.number().int().min(0).max(1000).default(5),
});
export type MedicineInput = z.infer<typeof medicineInputSchema>;

export async function saveMedicine(input: MedicineInput, id?: string, now = new Date()) {
  const cur = id ? (await db().select().from(medicines).where(eq(medicines.id, id)))[0] : null;
  if (id && !cur) return null;
  // One daily reminder per dose time. Simplest is to recreate them on every save.
  for (const rid of cur?.reminderIds || []) await deleteReminder(rid);
  const values = {
    name: input.name,
    dose: input.dose || null,
    times: [...input.times].sort(),
    stock: input.stock ?? null,
    perDose: input.perDose,
    refillAt: input.refillAt,
    refillAlertSentAt: null,
    reminderIds: [] as string[],
  };
  const [row] = id
    ? await db().update(medicines).set(values).where(eq(medicines.id, id)).returning()
    : await db().insert(medicines).values(values).returning();
  const ids: string[] = [];
  for (const t of values.times) {
    ids.push(
      await upsertReminder(
        null,
        {
          title: `💊 ${input.name}${input.dose ? ` · ${input.dose}` : ""}`,
          // Start today if this dose time is still ahead, otherwise tomorrow (no instant "missed" dose).
          date: t > fmtLocal(now, "HH:mm") ? fmtLocal(now, "yyyy-MM-dd") : fmtLocal(new Date(now.getTime() + 86400000), "yyyy-MM-dd"),
          time: t,
          recurrence: "daily",
          interval: 1,
          priority: "normal",
          category: "health",
          leadTimes: [0],
        },
        { kind: "medicine", id: row.id },
      ),
    );
  }
  const [withR] = await db().update(medicines).set({ reminderIds: ids }).where(eq(medicines.id, row.id)).returning();
  return withR;
}

export async function listMedicines() {
  return db().select().from(medicines).where(eq(medicines.active, true)).orderBy(asc(medicines.name));
}

export async function deleteMedicine(id: string) {
  const [m] = await db().select().from(medicines).where(eq(medicines.id, id));
  if (!m) return;
  for (const rid of m.reminderIds) await deleteReminder(rid);
  await db().delete(medicines).where(eq(medicines.id, id));
}

export async function refillMedicine(id: string, added: number) {
  const [m] = await db()
    .update(medicines)
    .set({ stock: sql`coalesce(${medicines.stock}, 0) + ${added}`, refillAlertSentAt: null })
    .where(eq(medicines.id, id))
    .returning();
  return m;
}

/**
 * Called when a reminder occurrence is marked done. For medicine doses this
 * lowers the stock and sends one "refill soon" alert when it runs low.
 */
export async function onReminderCompleted(r: Reminder) {
  const meta = r.meta as { kind?: string; id?: string } | null;
  if (meta?.kind !== "medicine" || !meta.id) return;
  const [m] = await db()
    .update(medicines)
    .set({ stock: sql`greatest(0, ${medicines.stock} - ${medicines.perDose})` })
    .where(and(eq(medicines.id, meta.id), sql`${medicines.stock} is not null`))
    .returning();
  if (!m || m.stock === null || m.stock > m.refillAt || m.refillAlertSentAt) return;
  await db().update(medicines).set({ refillAlertSentAt: new Date() }).where(eq(medicines.id, m.id));
  const daysLeft = m.times.length ? Math.floor(m.stock / (m.perDose * m.times.length)) : null;
  const text = `💊 ${m.name}: only ${m.stock} left${daysLeft !== null ? ` (about ${daysLeft} day${daysLeft === 1 ? "" : "s"})` : ""}. Time to refill.`;
  const { sendEmail, layout, esc } = await import("./email");
  const { sendTelegram, h } = await import("./telegram");
  const { sendPush } = await import("./push");
  await Promise.allSettled([
    sendEmail(`💊 Refill ${m.name} soon`, layout(`Refill ${m.name} soon`, `<p style="font-size:15px">${esc(text)}</p>`)),
    sendTelegram(h(text)),
    sendPush({ title: `Refill ${m.name} soon`, body: text, tag: `refill:${m.id}` }),
  ]);
}

// ------------------------------------------------------------- notes & lists

export const listInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  emoji: z.string().max(8).nullish(),
  kind: z.enum(["list", "note"]).default("list"),
  body: z.string().max(20000).nullish(),
  pinned: z.boolean().optional(),
});
/** Edits never change a note into a list (no defaults here). */
export const listPatchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  emoji: z.string().max(8).nullish(),
  body: z.string().max(20000).nullish(),
  pinned: z.boolean().optional(),
});

export async function allLists() {
  const ls = await db().select().from(lists).orderBy(desc(lists.pinned), desc(lists.updatedAt));
  const counts = await db()
    .select({ listId: listItems.listId, total: sql<number>`count(*)`.mapWith(Number), open: sql<number>`count(*) filter (where not ${listItems.done})`.mapWith(Number) })
    .from(listItems)
    .groupBy(listItems.listId);
  return ls.map((l) => ({ ...l, total: counts.find((c) => c.listId === l.id)?.total || 0, open: counts.find((c) => c.listId === l.id)?.open || 0 }));
}

export async function getList(id: string) {
  const [l] = await db().select().from(lists).where(eq(lists.id, id));
  if (!l) return null;
  const items = await db().select().from(listItems).where(eq(listItems.listId, id)).orderBy(asc(listItems.done), asc(listItems.sortOrder), asc(listItems.createdAt));
  return { ...l, items };
}

const LIST_EMOJI: [RegExp, string][] = [
  [/shop|grocer|buy/i, "🛒"],
  [/pack|trip|travel/i, "🧳"],
  [/idea/i, "💡"],
  [/movie|watch|film/i, "🎬"],
  [/book|read/i, "📚"],
  [/gift/i, "🎁"],
  [/todo|to-do/i, "✅"],
];

/** Add items to a list by name, creating the list if it doesn't exist ("shopping" → Shopping list). */
export async function addToList(name: string, items: string[]) {
  const clean = name.replace(/\b(list|my|the)\b/gi, "").trim() || "Shopping";
  const title = clean[0].toUpperCase() + clean.slice(1);
  let [l] = await db().select().from(lists).where(and(eq(lists.kind, "list"), ilike(lists.name, `%${clean}%`)));
  if (!l) [l] = await db().insert(lists).values({ name: title, emoji: LIST_EMOJI.find(([re]) => re.test(clean))?.[1] || "📝" }).returning();
  const base = Date.now() % 1e9;
  const rows = items.map((t) => t.trim()).filter(Boolean);
  if (rows.length) await db().insert(listItems).values(rows.map((text, i) => ({ listId: l.id, text, sortOrder: base + i })));
  await db().update(lists).set({ updatedAt: new Date() }).where(eq(lists.id, l.id));
  return { list: l, added: rows.length };
}

export const listAddSchema = z.object({ list: z.string().trim().min(1).max(60), items: z.array(z.string().trim().min(1).max(200)).min(1).max(50) });
export type ListAdd = z.infer<typeof listAddSchema>;
