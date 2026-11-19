import { connection, NextResponse } from "next/server";
import { listPeople, personInputSchema, savePerson } from "@/lib/life";

export async function GET() {
  await connection();
  return NextResponse.json({ people: await listPeople() });
}

export async function POST(req: Request) {
  const p = personInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  return NextResponse.json({ person: await savePerson(p.data) });
}
