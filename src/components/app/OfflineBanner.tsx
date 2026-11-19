"use client";

import { useEffect, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { flushQueue, QUEUE_EVENT, readQueue } from "./client";
import { useToast } from "./toast";

/** Shows when you're offline or have changes waiting, and syncs them when the network is back. */
export function OfflineBanner() {
  const { toast } = useToast();
  const [online, setOnline] = useState(true);
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      setWaiting(readQueue().length);
    };
    const sync = async () => {
      update();
      const n = await flushQueue();
      update();
      if (n) toast({ message: `Synced ${n} change${n > 1 ? "s" : ""} made offline` });
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read browser state once on mount
    sync();
    const onVis = () => document.visibilityState === "visible" && sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", update);
    window.addEventListener(QUEUE_EVENT, update);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", update);
      window.removeEventListener(QUEUE_EVENT, update);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [toast]);

  if (online && !waiting) return null;
  return (
    <div className="mb-4 flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200">
      {online ? <RefreshCw className="h-4 w-4 shrink-0 animate-spin" /> : <CloudOff className="h-4 w-4 shrink-0" />}
      <span>
        {online ? "Syncing" : "You're offline"}
        {waiting ? ` · ${waiting} change${waiting > 1 ? "s" : ""} will sync when you're back online` : ". Showing what was last loaded"}
      </span>
    </div>
  );
}
