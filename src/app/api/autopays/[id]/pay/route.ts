import { NextResponse } from "next/server";
import { z } from "zod";
import { payEarly } from "@/lib/autopay";
import { isoDay } from "@/lib/day";
import { withUndo } from "@/lib/undo-route";

type Ctx = { params: Promise<{ id: string }> };
/** accountId: leave out for the usual account; null = "Other" (not one of your accounts). */
const body = z.object({ paidOn: isoDay().nullish(), accountId: z.string().uuid().nullable().optional() });

/** "Paid early": record the next payment now; the automatic one skips that date. */
export const POST = withUndo(async (req: Request, { params }: Ctx) => {
  const p = body.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  try {
    const r = await payEarly((await params).id, p.data.paidOn, new Date(), p.data.accountId);
    return NextResponse.json({ paid: r });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
});
