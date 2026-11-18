import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { getBudgets, setBudgets } from "@/lib/finance";

/** Budgets in paise, keyed by category ("__total__" = overall). */
export async function GET() {
  await connection(); // always read fresh data, never prerender
  return NextResponse.json({ budgets: await getBudgets() });
}

/** Replace budgets: { budgets: { [category]: rupees } }. 0 removes one. */
export async function PUT(req: Request) {
  const parsed = z
    .object({ budgets: z.record(z.string().min(1).max(40), z.coerce.number().min(0).max(100_000_000)) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  return NextResponse.json({ budgets: await setBudgets(parsed.data.budgets) });
}
