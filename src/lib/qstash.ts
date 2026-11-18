import { Client, Receiver } from "@upstash/qstash";
import { config } from "./config";

export function qstashEnabled() {
  return Boolean(process.env.QSTASH_TOKEN);
}

let _client: Client | null = null;
function client() {
  if (!_client) {
    _client = new Client({
      token: process.env.QSTASH_TOKEN!,
      ...(process.env.QSTASH_URL ? { baseUrl: process.env.QSTASH_URL } : {}),
    });
  }
  return _client;
}

/** Ask QStash to POST to /api/deliver at `at`. Returns the QStash message id. */
export async function scheduleDelivery(deliveryId: string, at: Date) {
  const res = await client().publishJSON({
    url: `${config.appUrl}/api/deliver`,
    body: { deliveryId },
    notBefore: Math.floor(at.getTime() / 1000),
    deduplicationId: deliveryId,
    retries: 3,
  });
  return "messageId" in res ? res.messageId : null;
}

export async function verifyQstash(req: Request, body: string) {
  const signature = req.headers.get("upstash-signature");
  if (!signature) return false;
  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
  });
  try {
    return await receiver.verify({ signature, body });
  } catch {
    return false;
  }
}
