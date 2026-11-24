"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { Crosshair, MapPin, Plus, Trash2 } from "lucide-react";
import { api, refreshAll, useData } from "@/components/app/client";
import { Empty, PageTitle, Section, SkeletonList } from "@/components/app/rows";
import { useToast } from "@/components/app/toast";
import { field, label } from "@/components/app/ReminderEditor";
import { Modal, primaryBtn, useSubmit } from "@/components/screens/MoneyPlus";
import { Back } from "@/components/screens/LifeScreens";

type Place = { id: string; name: string; lat: number; lng: number; radius: number };
type PR = { id: string; text: string; place: string; on: "arrive" | "leave"; repeat: boolean; active: boolean; lastFiredAt?: string };

const norm = (s: string) => s.trim().toLowerCase().replace(/^(the|my)\s+/, "");

export function PlacesScreen() {
  const { data, loading } = useData<{ places: Place[]; reminders: PR[] }>("/api/places");
  const { toast } = useToast();
  const [addingPlace, setAddingPlace] = useState(false);
  const [addingReminder, setAddingReminder] = useState(false);
  const [perm, setPerm] = useState<string>("unknown");

  useEffect(() => {
    navigator.permissions
      ?.query({ name: "geolocation" as PermissionName })
      .then((st) => {
        setPerm(st.state);
        st.onchange = () => setPerm(st.state);
      })
      .catch(() => null);
  }, []);

  const places = data?.places || [];
  const reminders = data?.reminders || [];
  const call = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast({ message: msg });
      refreshAll();
    } catch (e) {
      toast({ message: (e as Error).message, tone: "error" });
    }
  };

  return (
    <div>
      <Back />
      <PageTitle title="Places" subtitle="Reminders for when you reach or leave a place" />

      <div className={clsx("mb-5 rounded-2xl px-4 py-3 text-sm", perm === "granted" ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : "bg-amber-500/10 text-amber-800 dark:text-amber-200")}>
        {perm === "granted" ? (
          <>📍 Location is on. Place reminders work <b>while Remindo is open</b> on your phone (Android may pause it in the background).</>
        ) : perm === "denied" ? (
          <>Location is blocked for Remindo. Allow it in your browser&apos;s site settings, then come back.</>
        ) : (
          <>
            Place reminders need your location, only while Remindo is open.{" "}
            <button className="font-semibold underline" onClick={() => navigator.geolocation.getCurrentPosition(() => setPerm("granted"), () => setPerm("denied"))}>
              Allow location
            </button>
          </>
        )}
      </div>

      {loading ? (
        <SkeletonList rows={3} />
      ) : (
        <>
          <Section
            title="Place reminders"
            right={
              <button onClick={() => setAddingReminder(true)} className="flex items-center gap-1 text-indigo-500">
                <Plus className="h-4 w-4" /> New
              </button>
            }
          >
            {!reminders.length ? (
              <Empty
                icon={<MapPin className="h-6 w-6" />}
                title="Remind me when I get there"
                text={`Try: "Remind me to submit the form when I reach office", or add one here.`}
                action={
                  <button data-submit className={primaryBtn} onClick={() => setAddingReminder(true)}>
                    New place reminder
                  </button>
                }
              />
            ) : (
              <div className="card divide-y divide-line overflow-hidden rounded-2xl">
                {reminders.map((r) => {
                  const known = places.some((p) => norm(p.name) === norm(r.place));
                  return (
                    <div key={r.id} className={clsx("flex items-center gap-3 px-4 py-3", !r.active && "opacity-50")}>
                      <MapPin className="h-5 w-5 shrink-0 text-indigo-500" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{r.text}</p>
                        <p className="truncate text-xs text-muted">
                          {r.on === "arrive" ? "When I reach" : "When I leave"} {r.place}
                          {r.repeat ? " · every time" : " · once"}
                          {!known && <span className="text-amber-600"> · save this place below</span>}
                          {!r.active && r.lastFiredAt && " · done"}
                        </p>
                      </div>
                      <button
                        onClick={() => call(() => api(`/api/place-reminders/${r.id}`, { method: "PATCH", json: { active: !r.active } }), r.active ? "Paused" : "Turned on")}
                        className="rounded-lg px-2 py-1 text-xs font-medium text-indigo-500 hover:bg-raised"
                      >
                        {r.active ? "Pause" : "Turn on"}
                      </button>
                      <button onClick={() => call(() => api(`/api/place-reminders/${r.id}`, { method: "DELETE" }), "Deleted")} className="p-1.5 text-subtle hover:text-rose-500" aria-label="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section
            title="Saved places"
            right={
              <button onClick={() => setAddingPlace(true)} className="flex items-center gap-1 text-indigo-500">
                <Plus className="h-4 w-4" /> Add
              </button>
            }
          >
            {!places.length ? (
              <button onClick={() => setAddingPlace(true)} className="card w-full rounded-2xl px-4 py-5 text-center text-sm text-muted hover:bg-raised">
                Go to a place (office, home, gym…) and <span className="text-indigo-500">save it here</span>.
              </button>
            ) : (
              <div className="card divide-y divide-line overflow-hidden rounded-2xl">
                {places.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500/15 text-indigo-500">
                      <MapPin className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-muted">Within {p.radius} m</p>
                    </div>
                    <a
                      href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-raised hover:text-fg"
                    >
                      Map
                    </a>
                    <button onClick={() => call(() => api(`/api/places?id=${p.id}`, { method: "DELETE" }), "Place removed")} className="p-1.5 text-subtle hover:text-rose-500" aria-label={`Remove ${p.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}

      {addingPlace && <PlaceForm onClose={() => setAddingPlace(false)} onAllowed={() => setPerm("granted")} />}
      {addingReminder && <PlaceReminderForm places={places} onClose={() => setAddingReminder(false)} />}
    </div>
  );
}

function PlaceForm({ onClose, onAllowed }: { onClose: () => void; onAllowed: () => void }) {
  const { busy, run } = useSubmit();
  const [name, setName] = useState("");
  const [radius, setRadius] = useState(150);
  const [pos, setPos] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [err, setErr] = useState("");
  const locate = () => {
    setErr("");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) });
        onAllowed();
      },
      (e) => setErr(e.code === 1 ? "Location is blocked. Allow it in the browser's site settings." : "Couldn't get your location. Try again outside or near a window."),
      { enableHighAccuracy: true, timeout: 20_000 },
    );
  };
  useEffect(() => {
    // Locate once when the form opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser callback sets state later
    locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Modal title="Save this place" onClose={onClose}>
      <div className="grid gap-3">
        <div>
          <label className={label}>Name</label>
          <input autoFocus className={field} maxLength={40} placeholder="Office, Home, Gym…" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-raised px-3 py-2.5 text-sm">
          <Crosshair className="h-4 w-4 text-indigo-500" />
          <span className="flex-1">{pos ? `Your current location (±${pos.acc} m)` : err || "Finding your location…"}</span>
          <button className="text-xs font-medium text-indigo-500" onClick={locate}>
            Refresh
          </button>
        </div>
        <div>
          <label className={label}>Counts as &quot;there&quot; within</label>
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-raised p-1">
            {[100, 150, 300, 500].map((r) => (
              <button key={r} onClick={() => setRadius(r)} className={clsx("rounded-lg py-1.5 text-sm", radius === r ? "bg-surface font-medium shadow-sm ring-1 ring-line" : "text-muted")}>
                {r} m
              </button>
            ))}
          </div>
        </div>
        <button
          data-submit
          className={primaryBtn}
          disabled={busy || !name.trim() || !pos}
          onClick={() => run(() => api("/api/places", { method: "POST", json: { name, lat: pos!.lat, lng: pos!.lng, radius } }), `Saved ${name}`, onClose)}
        >
          Save place
        </button>
      </div>
    </Modal>
  );
}

function PlaceReminderForm({ places, onClose }: { places: Place[]; onClose: () => void }) {
  const { busy, run } = useSubmit();
  const [v, setV] = useState({ text: "", place: places[0]?.name || "", on: "arrive" as "arrive" | "leave", repeat: false });
  return (
    <Modal title="New place reminder" onClose={onClose}>
      <div className="grid gap-3">
        <div>
          <label className={label}>Remind me to</label>
          <input autoFocus className={field} maxLength={200} placeholder="Submit the leave form" value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-raised p-1">
          {(["arrive", "leave"] as const).map((o) => (
            <button key={o} onClick={() => setV({ ...v, on: o })} className={clsx("rounded-lg py-2 text-sm", v.on === o ? "bg-surface font-medium shadow-sm ring-1 ring-line" : "text-muted")}>
              {o === "arrive" ? "When I reach" : "When I leave"}
            </button>
          ))}
        </div>
        <div>
          <label className={label}>Place</label>
          <input className={field} list="saved-places" maxLength={40} placeholder="Office" value={v.place} onChange={(e) => setV({ ...v, place: e.target.value })} />
          <datalist id="saved-places">
            {places.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={v.repeat} onChange={(e) => setV({ ...v, repeat: e.target.checked })} className="h-4 w-4 accent-indigo-500" />
          Every time (not just once)
        </label>
        <button data-submit className={primaryBtn} disabled={busy || !v.text.trim() || !v.place.trim()} onClick={() => run(() => api("/api/place-reminders", { method: "POST", json: { items: [v] } }), "Place reminder saved", onClose)}>
          Save
        </button>
      </div>
    </Modal>
  );
}
