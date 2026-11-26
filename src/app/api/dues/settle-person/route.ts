import { NextResponse } from "next/server";
import { z } from "zod";
import { settlePerson } from "@/lib/moneyplus";
import { withUndo } from "@/lib/undo-route";

/** Settle up with someone: closes all their open dues and split shares. */
export const POST = withUndo(async (req: Request) => {
  const p = z.object({ person: z.string().trim().min(1).max(40), accountId: z.string().uuid().nullish() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Who are you settling with?" }, { status: 400 });
  return NextResponse.json({ settled: await settlePerson(p.data.person, { accountId: p.data.accountId }) });
});
