import { NextResponse } from "next/server";
import { parsePrompt } from "@/lib/parse";

/** Turn a typed or spoken note into reminder drafts for the user to confirm. */
export async function POST(req: Request) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) return NextResponse.json({ error: "Say or type something first" }, { status: 400 });
  if (text.length > 2000) return NextResponse.json({ error: "That's too long — keep it under 2000 characters" }, { status: 400 });
  return NextResponse.json(await parsePrompt(text.trim()));
}
