"use client";

import { useEffect, useRef } from "react";
import { api, refreshAll, useData } from "./client";
import { useToast } from "./toast";

type Place = { id: string; name: string; lat: number; lng: number; radius: number };
type PR = { id: string; text: string; place: string; on: "arrive" | "leave"; repeat: boolean; active: boolean; lastFiredAt?: string };

const norm = (s: string) => s.trim().toLowerCase().replace(/^(the|my)\s+/, "");
function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const r = (x: number) => (x * Math.PI) / 180;
  const s = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Location reminders: while Remindo is open, watch where you are (only if you've
 * already allowed location) and fire "when I reach / leave X" reminders.
 */
export function LocationWatcher() {
  const { data } = useData<{ places: Place[]; reminders: PR[] }>("/api/places");
  const { toast } = useToast();
  const inside = useRef<Record<string, boolean>>({});
  const firing = useRef<Set<string>>(new Set());

  const active = (data?.reminders || []).filter((r) => r.active && (data?.places || []).some((p) => norm(p.name) === norm(r.place)));
  const key = JSON.stringify([active.map((r) => r.id + r.on + r.place), data?.places]);

  useEffect(() => {
    if (!active.length || !("geolocation" in navigator)) return;
    let watch: number | null = null;
    let cancelled = false;
    const places = data!.places;

    const fire = async (r: PR, p: Place) => {
      if (firing.current.has(r.id)) return;
      firing.current.add(r.id);
      try {
        await api(`/api/place-reminders/${r.id}`, { method: "POST" });
        const body = `You ${r.on === "arrive" ? "arrived at" : "left"} ${p.name}`;
        if ("Notification" in window && Notification.permission === "granted") {
          const reg = await navigator.serviceWorker?.ready.catch(() => null);
          await reg?.showNotification(`📍 ${r.text}`, { body, tag: `place:${r.id}`, icon: "/icon-192.png", badge: "/badge-96.png" });
        }
        toast({ message: `📍 ${r.text} · ${body}`, duration: 10000 });
        refreshAll();
      } catch {
        firing.current.delete(r.id);
      }
    };

    const onFix = (pos: GeolocationPosition) => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const slack = Math.min(pos.coords.accuracy || 0, 200) / 2;
      for (const p of places) {
        const now = distanceM(here, p) <= p.radius + slack;
        const before = inside.current[p.id];
        inside.current[p.id] = now;
        for (const r of active.filter((x) => norm(x.place) === norm(p.name))) {
          const firedToday = r.lastFiredAt && new Date(r.lastFiredAt).toDateString() === new Date().toDateString();
          if (r.on === "arrive" && now && before !== true && !(before === undefined && firedToday)) fire(r, p);
          if (r.on === "leave" && !now && before === true) fire(r, p);
        }
      }
    };

    // Only watch if location is already allowed (the Places screen asks for it), so we never pop up a prompt here.
    (navigator.permissions?.query({ name: "geolocation" as PermissionName }) ?? Promise.resolve({ state: "prompt" } as PermissionStatus))
      .then((st) => {
        if (cancelled || st.state !== "granted") return;
        watch = navigator.geolocation.watchPosition(onFix, () => null, { enableHighAccuracy: true, maximumAge: 30_000, timeout: 60_000 });
      })
      .catch(() => null);
    return () => {
      cancelled = true;
      if (watch !== null) navigator.geolocation.clearWatch(watch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the reminders/places change
  }, [key]);

  return null;
}
