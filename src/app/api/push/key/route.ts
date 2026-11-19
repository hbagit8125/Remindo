import { connection, NextResponse } from "next/server";
import { vapidKeys } from "@/lib/push";

/** Public key the browser needs to subscribe to push. */
export async function GET() {
  await connection();
  return NextResponse.json({ publicKey: (await vapidKeys()).publicKey });
}
