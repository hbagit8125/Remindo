import { NextResponse } from "next/server";
import { parsePrompt } from "@/lib/parse";
import { answerQuestion, resolveCommand } from "@/lib/assistant";

/**
 * Understand a typed or spoken note. Returns drafts to save, or an exact
 * answer to a question, or proposed changes for you to confirm.
 */
export async function POST(req: Request) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) return NextResponse.json({ error: "Say or type something first" }, { status: 400 });
  if (text.length > 2000) return NextResponse.json({ error: "That's too long. Keep it under 2000 characters" }, { status: 400 });
  const r = await parsePrompt(text.trim());
  const answer = r.question ? await answerQuestion(r.question) : null;
  const proposals = [];
  for (const c of r.commands || []) proposals.push({ command: c, candidates: await resolveCommand(c) });
  return NextResponse.json({ ...r, answer, proposals });
}
