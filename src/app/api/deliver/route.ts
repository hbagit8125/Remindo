import { NextResponse } from "next/server";
import { verifyQstash } from "@/lib/qstash";
import { sendDelivery } from "@/lib/scheduler";

/** Called by QStash at the exact alert time. */
export async function POST(req: Request) {
  const body = await req.text();
  if (!(await verifyQstash(req, body))) return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  const { deliveryId } = JSON.parse(body || "{}") as { deliveryId?: string };
  if (!deliveryId) return NextResponse.json({ error: "Missing deliveryId" }, { status: 400 });
  const result = await sendDelivery(deliveryId);
  // A 500 makes QStash retry; failed sends were put back in the queue.
  return NextResponse.json({ result }, { status: result === "failed" ? 500 : 200 });
}
