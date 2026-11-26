import { connection, NextResponse } from "next/server";
import { createSplit, friendly, knownPeople, listGroups, splitsOverview } from "@/lib/splits";
import { withUndo } from "@/lib/undo-route";

/** Splits tab: totals, people, recent splits, saved groups and names you've used. */
export async function GET() {
  await connection();
  const [overview, groups, people] = await Promise.all([splitsOverview(), listGroups(), knownPeople()]);
  return NextResponse.json({ ...overview, groups, known: people });
}

export const POST = withUndo(async (req: Request) => {
  try {
    return NextResponse.json({ split: await createSplit(await req.json()) });
  } catch (e) {
    return NextResponse.json({ error: friendly(e) }, { status: 400 });
  }
});
