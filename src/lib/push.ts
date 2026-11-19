import * as webpush from "web-push";
import { eq } from "drizzle-orm";
import { db, pushSubscriptions } from "@/db";
import { getSetting, setSetting } from "./settings";
import { config } from "./config";

type Keys = { publicKey: string; privateKey: string };

/**
 * VAPID keys identify this app to the browser push services. They're created
 * automatically on first use and kept in the database, so there's nothing to
 * configure. Env vars override them if you ever want to set your own.
 */
export async function vapidKeys(): Promise<Keys> {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const saved = await getSetting<Keys>("vapid");
  if (saved) return saved;
  const keys = webpush.generateVAPIDKeys();
  await setSetting("vapid", keys);
  return keys;
}

export type PushPayload = {
  title: string;
  body: string;
  /** Same tag replaces an older notification instead of stacking. */
  tag?: string;
  url?: string;
  /** Keep on screen until dismissed (used for high priority). */
  sticky?: boolean;
  /** Signed action tokens for the notification buttons. */
  actions?: { action: string; title: string; token: string }[];
};

/** Send to every subscribed device. Dead subscriptions are removed. Returns how many got it. */
export async function sendPush(payload: PushPayload) {
  const subs = await db().select().from(pushSubscriptions);
  if (!subs.length) return 0;
  const keys = await vapidKeys();
  webpush.setVapidDetails(`mailto:${config.notifyEmail || "admin@example.com"}`, keys.publicKey, keys.privateKey);
  let ok = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 6 * 3600, urgency: payload.sticky ? "high" : "normal" },
        );
        ok++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db().delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
      }
    }),
  );
  return ok;
}
