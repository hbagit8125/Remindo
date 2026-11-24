import * as T from "@/db";
import { listAllTransactions, toCsv } from "./finance";
import { esc, layout, sendEmail } from "./email";
import { fmtLocal } from "./time";

/** Your own data. Secrets (push keys, bot token, VAPID keys) and internal queues are left out. */
const TABLES = {
  reminders: T.reminders,
  completions: T.completions,
  tasks: T.tasks,
  transactions: T.transactions,
  accounts: T.accounts,
  budgets: T.budgets,
  favourites: T.favourites,
  dues: T.dues,
  splits: T.splits,
  splitGroups: T.splitGroups,
  goals: T.goals,
  goalContributions: T.goalContributions,
  documents: T.documents,
  people: T.people,
  medicines: T.medicines,
  lists: T.lists,
  listItems: T.listItems,
} as const;

export async function exportAll(now = new Date()) {
  const data: Record<string, unknown[]> = {};
  for (const [name, table] of Object.entries(TABLES)) data[name] = await T.db().select().from(table);
  return { app: "Remindo", version: 1, exportedAt: now.toISOString(), data };
}

export async function sendBackup(now = new Date()) {
  const dump = await exportAll(now);
  const csv = toCsv(await listAllTransactions());
  const day = fmtLocal(now, "yyyy-MM-dd");
  const counts = Object.entries(dump.data)
    .filter(([, rows]) => rows.length)
    .map(([k, rows]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">${esc(k)}</td><td style="padding:4px 0;text-align:right">${rows.length}</td></tr>`)
    .join("");
  await sendEmail(
    `🗄️ Remindo backup · ${day}`,
    layout(
      "Your weekly backup",
      `<p style="font-size:14px;color:#374151">Two files are attached: a full backup (JSON) and your money entries (CSV, opens in Excel or Google Sheets). Keep this email and you always have a copy.</p>
<table style="font-size:13px;margin-top:12px">${counts}</table>`,
    ),
    [
      { filename: `remindo-backup-${day}.json`, content: JSON.stringify(dump) },
      { filename: `remindo-transactions-${day}.csv`, content: "﻿" + csv },
    ],
  );
  return { ok: true, rows: Object.values(dump.data).reduce((n, r) => n + r.length, 0) };
}
