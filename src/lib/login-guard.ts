import { getSetting, setSetting } from "./settings";

/**
 * Brute-force protection for the passcode screen.
 * - 5 wrong tries from one address in 15 minutes → that address waits.
 * - 20 wrong tries in an hour from anywhere → sign-in is paused for an hour
 *   (you stay signed in on your own devices; their sessions keep working).
 * - You get a Telegram + email alert when either kicks in.
 */
type Fail = { ip: string; at: number };
type Guard = { fails: Fail[]; lockedUntil?: number; alertedAt?: number };

const KEY = "loginGuard";
const PER_IP = 5;
const PER_IP_WINDOW = 15 * 60_000;
const GLOBAL = 20;
const GLOBAL_WINDOW = 60 * 60_000;

export function clientIp(req: Request) {
  // Vercel sets x-forwarded-for; the first entry is the real client.
  return (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown").split(",")[0].trim().slice(0, 64);
}

async function load(now: number): Promise<Guard> {
  const g = (await getSetting<Guard>(KEY).catch(() => null)) || { fails: [] };
  return { ...g, fails: (g.fails || []).filter((f) => now - f.at < GLOBAL_WINDOW) };
}

/** Minutes to wait, or 0 if this address may try now. */
export async function loginBlocked(ip: string, now = Date.now()) {
  const g = await load(now);
  if (g.lockedUntil && g.lockedUntil > now) return Math.ceil((g.lockedUntil - now) / 60_000);
  const mine = g.fails.filter((f) => f.ip === ip && now - f.at < PER_IP_WINDOW);
  if (mine.length >= PER_IP) return Math.ceil((mine[0].at + PER_IP_WINDOW - now) / 60_000);
  return 0;
}

export async function recordFailure(ip: string, now = Date.now()) {
  const g = await load(now);
  g.fails.push({ ip, at: now });
  const mine = g.fails.filter((f) => f.ip === ip && now - f.at < PER_IP_WINDOW).length;
  const total = g.fails.length;
  if (total >= GLOBAL) g.lockedUntil = now + GLOBAL_WINDOW;
  const shouldAlert = (mine >= PER_IP || total >= GLOBAL) && (!g.alertedAt || now - g.alertedAt > GLOBAL_WINDOW);
  if (shouldAlert) g.alertedAt = now;
  await setSetting(KEY, g);
  if (shouldAlert) await alertOwner(ip, mine, total, Boolean(g.lockedUntil && g.lockedUntil > now));
}

export async function recordSuccess(ip: string, now = Date.now()) {
  const g = await load(now);
  await setSetting(KEY, { ...g, fails: g.fails.filter((f) => f.ip !== ip) });
}

async function alertOwner(ip: string, mine: number, total: number, locked: boolean) {
  const text = `🔐 Remindo: ${total} wrong passcode attempt${total === 1 ? "" : "s"} in the last hour (${mine} from ${ip}).${
    locked ? " Sign-in is paused for an hour." : " That address has to wait 15 minutes."
  } If this wasn't you, change APP_PASSCODE in Vercel and use "Sign out all devices".`;
  const [{ sendTelegram, h }, { sendEmail, layout, esc }] = await Promise.all([import("./telegram"), import("./email")]);
  await Promise.allSettled([
    sendTelegram(h(text)),
    sendEmail("🔐 Remindo: repeated wrong passcodes", layout("Someone is guessing your passcode", `<p style="font-size:14px">${esc(text)}</p>`)),
  ]);
}
