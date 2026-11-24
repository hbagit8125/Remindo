import { randomBytes } from "node:crypto";
import { getSetting, setSetting } from "./settings";
import { safeEqual } from "./auth";

/**
 * Read-only key for the Android home-screen widget. It can only read today's list
 * (titles, times, done) — nothing else — and you can reset it any time in More.
 */
const KEY = "widgetKey";

export async function getWidgetKey(create = true) {
  const k = await getSetting<string>(KEY).catch(() => null);
  if (k || !create) return k;
  return resetWidgetKey();
}

export async function resetWidgetKey() {
  const k = randomBytes(24).toString("base64url");
  await setSetting(KEY, k);
  return k;
}

export async function checkWidgetKey(given: string | null) {
  const k = await getWidgetKey(false);
  return Boolean(k && given && safeEqual(given, k));
}
