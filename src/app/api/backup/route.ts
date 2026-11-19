import { connection, NextResponse } from "next/server";
import { exportAll, sendBackup } from "@/lib/backup";
import { today } from "@/lib/finance";

/** Download a full backup as JSON. */
export async function GET() {
  await connection();
  return new Response(JSON.stringify(await exportAll(), null, 1), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="remindo-backup-${today()}.json"`,
    },
  });
}

/** Email a backup now. */
export async function POST() {
  try {
    return NextResponse.json(await sendBackup());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
