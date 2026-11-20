import { NextResponse } from "next/server";
import { and, desc, ilike, ne, or, eq } from "drizzle-orm";
import { db, documents, dues, goals, listItems, lists, medicines, people, reminders, tasks, transactions } from "@/db";
import { describeRrule } from "@/lib/recurrence";

/** Search everything: reminders, tasks, money, lists & notes, people, documents, dues, medicines, goals. ?q=text (or an amount like 450). */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 100);
  if (q.length < 2) return NextResponse.json({ reminders: [], tasks: [], transactions: [], other: [] });
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const amount = Number(q.replace(/[₹,\s]/g, ""));
  const amountPaise = Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;

  const [r, t, tx] = await Promise.all([
    db()
      .select()
      .from(reminders)
      .where(and(ne(reminders.status, "archived"), or(ilike(reminders.title, like), ilike(reminders.notes, like), ilike(reminders.category, like))))
      .orderBy(desc(reminders.dueAt))
      .limit(15),
    db()
      .select()
      .from(tasks)
      .where(or(ilike(tasks.title, like), ilike(tasks.notes, like)))
      .orderBy(desc(tasks.createdAt))
      .limit(15),
    db()
      .select()
      .from(transactions)
      .where(
        or(
          ilike(transactions.note, like),
          ilike(transactions.merchant, like),
          ilike(transactions.category, like),
          ...(amountPaise ? [eq(transactions.amountPaise, amountPaise)] : []),
        ),
      )
      .orderBy(desc(transactions.date))
      .limit(20),
  ]);
  const [ls, items, ppl, docs, ds, meds, gs] = await Promise.all([
    db().select().from(lists).where(or(ilike(lists.name, like), ilike(lists.body, like))).limit(10),
    db()
      .select({ id: listItems.id, text: listItems.text, listId: listItems.listId, listName: lists.name, emoji: lists.emoji })
      .from(listItems)
      .innerJoin(lists, eq(lists.id, listItems.listId))
      .where(ilike(listItems.text, like))
      .limit(10),
    db().select().from(people).where(or(ilike(people.name, like), ilike(people.relation, like), ilike(people.giftIdeas, like))).limit(10),
    db().select().from(documents).where(or(ilike(documents.name, like), ilike(documents.number, like), ilike(documents.notes, like))).limit(10),
    db().select().from(dues).where(or(ilike(dues.person, like), ilike(dues.note, like))).limit(10),
    db().select().from(medicines).where(ilike(medicines.name, like)).limit(10),
    db().select().from(goals).where(and(eq(goals.archived, false), ilike(goals.name, like))).limit(10),
  ]);
  const other = [
    ...ls.map((l) => ({ id: l.id, emoji: l.emoji || (l.kind === "note" ? "🗒️" : "📝"), title: l.name, sub: l.kind === "note" ? "Note" : "List", href: `/lists?id=${l.id}` })),
    ...items.map((i) => ({ id: i.id, emoji: i.emoji || "📝", title: i.text, sub: `In ${i.listName}`, href: `/lists?id=${i.listId}` })),
    ...ppl.map((p) => ({ id: p.id, emoji: "🎂", title: p.name, sub: [p.relation, p.birthday && `Birthday ${p.birthday}`].filter(Boolean).join(" · ") || "Person", href: "/life/people" })),
    ...docs.map((d) => ({ id: d.id, emoji: "📄", title: d.name, sub: `Expires ${d.expiryDate}`, href: "/life/documents" })),
    ...ds.map((d) => ({
      id: d.id,
      emoji: "🤝",
      title: d.direction === "they_owe" ? `${d.person} owes you` : `You owe ${d.person}`,
      sub: `₹${(d.amountPaise / 100).toLocaleString("en-IN")}${d.settledAt ? " · settled" : ""}${d.note ? ` · ${d.note}` : ""}`,
      href: "/dues",
    })),
    ...meds.map((m) => ({ id: m.id, emoji: "💊", title: m.name, sub: m.times.join(", "), href: "/life/health" })),
    ...gs.map((g) => ({ id: g.id, emoji: g.emoji || "🎯", title: g.name, sub: "Savings goal", href: "/goals" })),
  ];
  return NextResponse.json({
    reminders: r.map((x) => ({ ...x, recurring: describeRrule(x.rrule) })),
    tasks: t,
    transactions: tx,
    other,
  });
}
