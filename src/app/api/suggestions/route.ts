import { connection, NextResponse } from "next/server";
import { acceptSuggestion, dismissSuggestion, getSuggestions } from "@/lib/suggestions";
import { withUndo } from "@/lib/undo-route";

export async function GET() {
  await connection();
  return NextResponse.json({ suggestions: await getSuggestions() });
}

/** { key, action: "accept" | "dismiss" } */
export const POST = withUndo(async (req: Request) => {
  const { key, action } = (await req.json().catch(() => ({}))) as { key?: string; action?: string };
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });
  if (action === "accept") {
    const s = await acceptSuggestion(key);
    return s ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Suggestion no longer applies" }, { status: 404 });
  }
  await dismissSuggestion(key);
  return NextResponse.json({ ok: true });
});
