import { NextResponse } from "next/server";
import { scanReceipt } from "@/lib/parse";

export const maxDuration = 60;

/** Receipt / UPI screenshot → expense drafts. Body: { image: base64 (no data: prefix), mimeType } */
export async function POST(req: Request) {
  const { image, mimeType } = (await req.json().catch(() => ({}))) as { image?: string; mimeType?: string };
  if (!image || !mimeType?.startsWith("image/")) return NextResponse.json({ error: "Send an image" }, { status: 400 });
  if (image.length > 6_000_000) return NextResponse.json({ error: "Image too large" }, { status: 413 });
  try {
    const r = await scanReceipt(image, mimeType);
    if (!r.transactions.length) return NextResponse.json({ error: "Couldn't find an amount in that image. Try a clearer photo." }, { status: 422 });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
