import { z } from "zod";
import { getSetting, setSetting } from "./settings";

/**
 * Location reminders ("remind me to buy milk when I reach office").
 * Saved places and their reminders live in settings. The phone checks your
 * location while Remindo is open and tells the server when one fires.
 */
export type Place = { id: string; name: string; lat: number; lng: number; radius: number };
export type PlaceReminder = {
  id: string;
  text: string;
  /** Matched to a saved place by name (so "office" works before the place is set up). */
  place: string;
  on: "arrive" | "leave";
  repeat: boolean;
  active: boolean;
  createdAt: string;
  lastFiredAt?: string;
};

const P = "places";
const R = "placeReminders";
const id = () => crypto.randomUUID();
const norm = (s: string) => s.trim().toLowerCase().replace(/^(the|my)\s+/, "");

export const placeInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radius: z.number().int().min(50).max(2000).default(150),
});
export const placeReminderInputSchema = z.object({
  text: z.string().trim().min(1).max(200),
  place: z.string().trim().min(1).max(40),
  on: z.enum(["arrive", "leave"]).default("arrive"),
  repeat: z.boolean().default(false),
});
export type PlaceReminderInput = z.infer<typeof placeReminderInputSchema>;

export async function listPlaces() {
  return (await getSetting<Place[]>(P).catch(() => null)) || [];
}
export async function listPlaceReminders() {
  return (await getSetting<PlaceReminder[]>(R).catch(() => null)) || [];
}

/** Save a place (replaces one with the same name). */
async function savePlaceInner(input: z.infer<typeof placeInputSchema>) {
  const all = await listPlaces();
  const name = input.name.replace(/^\w/, (c) => c.toUpperCase());
  const existing = all.find((p) => norm(p.name) === norm(name));
  const place: Place = { id: existing?.id || id(), ...input, name };
  await setSetting(P, [...all.filter((p) => p.id !== place.id), place]);
  return place;
}
async function deletePlaceInner(placeId: string) {
  await setSetting(
    P,
    (await listPlaces()).filter((p) => p.id !== placeId),
  );
}

async function addPlaceRemindersInner(items: PlaceReminderInput[], now = new Date()) {
  const all = await listPlaceReminders();
  const added = items.map((i) => ({ ...i, place: i.place.replace(/^(the|my)\s+/i, ""), id: id(), active: true, createdAt: now.toISOString() }));
  await setSetting(R, [...all, ...added]);
  return added;
}
async function updatePlaceReminderInner(rid: string, patch: Partial<Pick<PlaceReminder, "active" | "text" | "repeat" | "on" | "place">>) {
  const all = await listPlaceReminders();
  await setSetting(
    R,
    all.map((r) => (r.id === rid ? { ...r, ...patch } : r)),
  );
}
async function deletePlaceReminderInner(rid: string) {
  await setSetting(
    R,
    (await listPlaceReminders()).filter((r) => r.id !== rid),
  );
}

/** The phone saw you arrive/leave: record it, switch off one-time reminders, and send a Telegram copy. */
export async function firePlaceReminder(rid: string, now = new Date()) {
  const all = await listPlaceReminders();
  const r = all.find((x) => x.id === rid);
  if (!r || !r.active) return null;
  // Ignore duplicates within 10 minutes (two tabs, GPS jitter).
  if (r.lastFiredAt && now.getTime() - Date.parse(r.lastFiredAt) < 10 * 60_000) return r;
  const next = { ...r, lastFiredAt: now.toISOString(), active: r.repeat };
  await setSetting(
    R,
    all.map((x) => (x.id === rid ? next : x)),
  );
  const { sendTelegram, h } = await import("./telegram");
  await sendTelegram(`📍 <b>${h(r.text)}</b>\nYou ${r.on === "arrive" ? "arrived at" : "left"} ${h(r.place)}`).catch(() => null);
  return next;
}

/** Find the saved place for a reminder (by name). */
export function placeFor(r: Pick<PlaceReminder, "place">, places: Place[]) {
  return places.find((p) => norm(p.name) === norm(r.place)) || null;
}

/** Distance in metres between two points. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ------------------------------------------------------------- undoable wrappers (places live in settings)

async function withSnap<V>(key: string, title: string, fn: () => Promise<V>) {
  const u = await import("./undo");
  return u.recorded({ title, kind: "edit" }, async (rec) => {
    rec(await u.snapSetting(key));
    return fn();
  });
}
export function savePlace(input: z.infer<typeof placeInputSchema>) {
  return withSnap(P, `Saved place ${input.name}`, () => savePlaceInner(input));
}
export async function deletePlace(placeId: string) {
  const p = (await listPlaces()).find((x) => x.id === placeId);
  return withSnap(P, `Removed place ${p?.name || ""}`.trim(), () => deletePlaceInner(placeId));
}
export function addPlaceReminders(items: PlaceReminderInput[], now = new Date()) {
  return withSnap(R, items.length === 1 ? `Added “${items[0].text}” at ${items[0].place}` : `Added ${items.length} place reminders`, () => addPlaceRemindersInner(items, now));
}
export async function updatePlaceReminder(rid: string, patch: Partial<Pick<PlaceReminder, "active" | "text" | "repeat" | "on" | "place">>) {
  const r = (await listPlaceReminders()).find((x) => x.id === rid);
  const title = patch.active === false ? `${r?.repeat ? "Paused" : "Done"} · ${r?.text}` : patch.active === true ? `Turned on · ${r?.text}` : `Edited “${r?.text}”`;
  return withSnap(R, title, () => updatePlaceReminderInner(rid, patch));
}
export async function deletePlaceReminder(rid: string) {
  const r = (await listPlaceReminders()).find((x) => x.id === rid);
  return withSnap(R, `Deleted “${r?.text || "place reminder"}”`, () => deletePlaceReminderInner(rid));
}
