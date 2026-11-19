"use client";

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import {
  BellRing,
  Download,
  ExternalLink,
  Loader2,
  LogOut,
  Mail,
  Moon,
  MoonStar,
  Send,
  Smartphone,
  Sun,
} from "lucide-react";
import { api, useData } from "@/components/app/client";
import { PageTitle } from "@/components/app/rows";
import { useToast } from "@/components/app/toast";
import { logout, useTheme } from "@/components/app/AppShell";

type Prefs = {
  channels: { email: boolean; push: boolean; telegram: boolean };
  quietHours: { enabled: boolean; start: string; end: string };
  emails: { morning: boolean; evening: boolean; weekly: boolean; monthly: boolean };
};
type SettingsRes = {
  prefs: Prefs;
  push: { devices: number };
  telegram: { hasToken: boolean; tokenFromEnv: boolean; botUsername: string | null; connected: boolean; chatName: string | null };
};

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={clsx("relative h-7 w-12 shrink-0 rounded-full transition", on ? "bg-indigo-500" : "bg-[var(--line)]")}
    >
      <span className={clsx("absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

function Row({ icon, title, desc, children }: { icon?: React.ReactNode; title: string; desc?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      {icon && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-raised text-muted">{icon}</span>}
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium">{title}</p>
        {desc && <div className="text-xs text-muted">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function Group({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-subtle">{title}</h3>
      <div className="card divide-y divide-[var(--line)] overflow-hidden rounded-3xl">{children}</div>
      {note && <p className="mt-2 px-1 text-xs text-muted">{note}</p>}
    </section>
  );
}

const btn = "rounded-xl border border-line px-3 py-2 text-xs font-medium hover:bg-raised disabled:opacity-50";

// ------------------------------------------------------------- push on this device

type PushState = "loading" | "unsupported" | "blocked" | "on" | "off";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function usePush() {
  const [state, setState] = useState<PushState>("loading");
  const check = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
    if (Notification.permission === "denied") return setState("blocked");
    const reg = await navigator.serviceWorker.register("/sw.js");
    const sub = await reg.pushManager.getSubscription();
    setState(sub ? "on" : "off");
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read browser state on mount
    check();
  }, [check]);

  async function enable() {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return setState(perm === "denied" ? "blocked" : "off");
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api<{ publicKey: string }>("/api/push/key");
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    await api("/api/push/subscribe", { method: "POST", json: { ...sub.toJSON(), label: navigator.userAgent.slice(0, 100) } });
    setState("on");
  }
  async function disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api("/api/push/subscribe", { method: "DELETE", json: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    }
    setState("off");
  }
  return { state, enable, disable };
}

// ------------------------------------------------------------- screen

export function MoreScreen() {
  const { toast } = useToast();
  const theme = useTheme();
  const push = usePush();
  const { data, reload, setData } = useData<SettingsRes>("/api/settings");
  const [busy, setBusy] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [waitingTg, setWaitingTg] = useState(false);

  const prefs = data?.prefs;

  async function savePrefs(next: Prefs) {
    if (!data) return;
    setData({ ...data, prefs: next });
    try {
      await api("/api/settings", { method: "PUT", json: next });
    } catch (e) {
      toast({ message: (e as Error).message, tone: "error" });
      reload();
    }
  }

  async function test(channel: "push" | "telegram" | "email") {
    setBusy(`test-${channel}`);
    try {
      const r = await api<Record<string, string>>("/api/notify/test", { method: "POST", json: { channel } });
      const v = r[channel];
      toast({ message: v === "sent" ? "Test sent. Check your phone" : `Not sent: ${v}`, tone: v === "sent" ? "ok" : "error" });
    } catch (e) {
      toast({ message: (e as Error).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function connectTelegram() {
    setBusy("tg");
    try {
      const r = await api<{ link: string }>("/api/telegram/connect", { method: "POST", json: { token: token || undefined } });
      setToken("");
      setWaitingTg(true);
      window.open(r.link, "_blank");
    } catch (e) {
      toast({ message: (e as Error).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function disconnectTelegram() {
    setBusy("tg");
    await api("/api/telegram/connect", { method: "DELETE" }).catch(() => null);
    setBusy(null);
    reload();
    toast({ message: "Telegram disconnected" });
  }

  // While waiting for you to tap Start in Telegram, check every few seconds.
  useEffect(() => {
    if (!waitingTg) return;
    if (data?.telegram.connected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- stop polling once linked
      setWaitingTg(false);
      toast({ message: "Telegram connected 🎉" });
      return;
    }
    const t = setInterval(reload, 3000);
    const stop = setTimeout(() => setWaitingTg(false), 3 * 60_000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [waitingTg, data?.telegram.connected, reload, toast]);

  if (!data || !prefs) {
    return (
      <div>
        <PageTitle title="More" />
        <div className="space-y-3">
          <div className="skeleton h-48 rounded-3xl" />
          <div className="skeleton h-32 rounded-3xl" />
        </div>
      </div>
    );
  }

  const tg = data.telegram;
  const pushDesc: Record<PushState, string> = {
    loading: "Checking…",
    unsupported: "This browser can't receive push. Open Remindo from your home screen in Chrome.",
    blocked: "Blocked. Allow notifications for this site in your browser settings, then reload.",
    on: `On for this phone${data.push.devices > 1 ? ` · ${data.push.devices} devices in total` : ""}`,
    off: "Get reminders as phone notifications, even when the app is closed.",
  };

  return (
    <div>
      <PageTitle title="More" subtitle="Notifications, emails and app settings" />

      <Group title="Where reminders reach you">
        <Row icon={<Smartphone className="h-[18px] w-[18px]" />} title="Phone notifications" desc={pushDesc[push.state]}>
          {push.state === "off" && (
            <button
              onClick={() => push.enable().catch((e) => toast({ message: (e as Error).message, tone: "error" }))}
              className="rounded-xl bg-indigo-500 px-3 py-2 text-xs font-semibold text-white"
            >
              Turn on
            </button>
          )}
          {push.state === "on" && <Toggle label="Phone notifications" on={prefs.channels.push} onChange={(v) => savePrefs({ ...prefs, channels: { ...prefs.channels, push: v } })} />}
        </Row>
        {push.state === "on" && (
          <div className="flex gap-2 px-4 pb-3.5 pl-16">
            <button className={btn} disabled={busy === "test-push"} onClick={() => test("push")}>
              {busy === "test-push" ? "Sending…" : "Send test"}
            </button>
            <button className={btn} onClick={() => push.disable()}>
              Turn off on this phone
            </button>
          </div>
        )}

        <Row
          icon={<Send className="h-[18px] w-[18px]" />}
          title="Telegram"
          desc={
            tg.connected
              ? `Connected${tg.chatName ? ` as ${tg.chatName}` : ""}${tg.botUsername ? ` · @${tg.botUsername}` : ""}`
              : waitingTg
                ? "Waiting for you to tap Start in Telegram…"
                : "Reminders with Done/Snooze buttons, and add things by text or voice note."
          }
        >
          {tg.connected ? (
            <Toggle label="Telegram alerts" on={prefs.channels.telegram} onChange={(v) => savePrefs({ ...prefs, channels: { ...prefs.channels, telegram: v } })} />
          ) : waitingTg ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
          ) : null}
        </Row>
        {tg.connected ? (
          <div className="flex flex-wrap gap-2 px-4 pb-3.5 pl-16">
            <button className={btn} disabled={busy === "test-telegram"} onClick={() => test("telegram")}>
              {busy === "test-telegram" ? "Sending…" : "Send test"}
            </button>
            {tg.botUsername && (
              <a className={clsx(btn, "flex items-center gap-1")} href={`https://t.me/${tg.botUsername}`} target="_blank" rel="noreferrer">
                Open chat <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <button className={clsx(btn, "text-rose-500")} disabled={busy === "tg"} onClick={disconnectTelegram}>
              Disconnect
            </button>
          </div>
        ) : (
          <div className="space-y-2 px-4 pb-4 pl-16">
            {!tg.tokenFromEnv && (
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={tg.hasToken ? "Bot token saved. Paste a new one to replace it" : "Paste bot token from @BotFather"}
                className="w-full rounded-xl border border-line bg-raised px-3 py-2.5 text-sm outline-none placeholder:text-subtle focus:border-indigo-400"
              />
            )}
            <button
              onClick={connectTelegram}
              disabled={busy === "tg" || (!token && !tg.hasToken)}
              className="flex items-center gap-2 rounded-xl bg-[#229ED9] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy === "tg" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {waitingTg ? "Open Telegram again" : "Connect"}
            </button>
            <p className="text-xs text-muted">Telegram opens; tap <b>Start</b> and come back here.</p>
          </div>
        )}

        <Row icon={<Mail className="h-[18px] w-[18px]" />} title="Email" desc="Every reminder, with Done / Snooze buttons">
          <Toggle label="Email alerts" on={prefs.channels.email} onChange={(v) => savePrefs({ ...prefs, channels: { ...prefs.channels, email: v } })} />
        </Row>
      </Group>

      <Group title="Quiet hours" note="High-priority reminders still come through. Email always arrives; held alerts are listed in your morning digest.">
        <Row icon={<MoonStar className="h-[18px] w-[18px]" />} title="Hold phone & Telegram alerts at night">
          <Toggle label="Quiet hours" on={prefs.quietHours.enabled} onChange={(v) => savePrefs({ ...prefs, quietHours: { ...prefs.quietHours, enabled: v } })} />
        </Row>
        {prefs.quietHours.enabled && (
          <div className="grid grid-cols-2 gap-3 px-4 py-3.5">
            {(["start", "end"] as const).map((k) => (
              <label key={k} className="text-xs text-muted">
                {k === "start" ? "From" : "Until"}
                <input
                  type="time"
                  value={prefs.quietHours[k]}
                  onChange={(e) => e.target.value && savePrefs({ ...prefs, quietHours: { ...prefs.quietHours, [k]: e.target.value } })}
                  className="mt-1 block w-full rounded-xl border border-line bg-raised px-3 py-2.5 text-[15px] text-fg outline-none focus:border-indigo-400"
                />
              </label>
            ))}
          </div>
        )}
      </Group>

      <Group title="Summary emails">
        <Row icon={<Sun className="h-[18px] w-[18px]" />} title="Morning digest" desc="Around 7am · today, overdue, spending">
          <Toggle label="Morning digest" on={prefs.emails.morning} onChange={(v) => savePrefs({ ...prefs, emails: { ...prefs.emails, morning: v } })} />
        </Row>
        <Row icon={<Moon className="h-[18px] w-[18px]" />} title="Evening review" desc="Around 9pm · done, pending, tomorrow, today's spend">
          <Toggle label="Evening review" on={prefs.emails.evening} onChange={(v) => savePrefs({ ...prefs, emails: { ...prefs.emails, evening: v } })} />
        </Row>
        <Row icon={<BellRing className="h-[18px] w-[18px]" />} title="Week ahead" desc="Sunday evening · next 7 days">
          <Toggle label="Week ahead" on={prefs.emails.weekly} onChange={(v) => savePrefs({ ...prefs, emails: { ...prefs.emails, weekly: v } })} />
        </Row>
      </Group>

      <Group title="App">
        <Row icon={theme.dark ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />} title="Dark mode">
          <Toggle label="Dark mode" on={theme.dark} onChange={() => theme.toggle()} />
        </Row>
        <a download href="/api/transactions/export" className="block hover:bg-raised">
          <Row icon={<Download className="h-[18px] w-[18px]" />} title="Export money data" desc="CSV for Excel / Google Sheets" />
        </a>
        <button onClick={logout} className="block w-full text-left hover:bg-raised">
          <Row icon={<LogOut className="h-[18px] w-[18px]" />} title="Lock Remindo" desc="You'll need your passcode to open it again" />
        </button>
      </Group>
    </div>
  );
}
