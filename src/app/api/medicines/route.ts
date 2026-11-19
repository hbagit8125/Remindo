import { connection, NextResponse } from "next/server";
import { listMedicines, medicineInputSchema, saveMedicine } from "@/lib/life";

export async function GET() {
  await connection();
  return NextResponse.json({ medicines: await listMedicines() });
}

export async function POST(req: Request) {
  const p = medicineInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message }, { status: 400 });
  return NextResponse.json({ medicine: await saveMedicine(p.data) });
}
