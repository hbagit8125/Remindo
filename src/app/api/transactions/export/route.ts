import { connection } from "next/server";
import { listAllTransactions, toCsv, today } from "@/lib/finance";

/** Download every transaction as CSV (opens in Excel / Google Sheets). */
export async function GET() {
  await connection(); // always read fresh data, never prerender
  const csv = toCsv(await listAllTransactions());
  return new Response("﻿" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="remindo-transactions-${today()}.csv"`,
    },
  });
}
