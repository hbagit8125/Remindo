"use client";

import { useRef, useState } from "react";
import { clsx } from "clsx";

type Action = { label: string; icon: React.ReactNode; className: string; onTrigger: () => void };

const THRESHOLD = 80;

/** Phone gesture: swipe right / left on a row to run an action. Desktop users get buttons instead. */
export function SwipeRow({
  children,
  right,
  left,
  className,
}: {
  children: React.ReactNode;
  /** Revealed when dragging to the right. */
  right?: Action;
  /** Revealed when dragging to the left. */
  left?: Action;
  className?: string;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; locked: "h" | "v" | null } | null>(null);

  const onStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, locked: null };
  };
  const onMove = (e: React.TouchEvent) => {
    const s = start.current;
    if (!s) return;
    const t = e.touches[0];
    const mx = t.clientX - s.x;
    const my = t.clientY - s.y;
    if (!s.locked) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      s.locked = Math.abs(mx) > Math.abs(my) ? "h" : "v";
    }
    if (s.locked !== "h") return;
    let next = mx;
    if (next > 0 && !right) next = 0;
    if (next < 0 && !left) next = 0;
    setDx(Math.max(-140, Math.min(140, next)));
  };
  const onEnd = () => {
    const d = dx;
    start.current = null;
    setDx(0);
    if (d > THRESHOLD) right?.onTrigger();
    else if (d < -THRESHOLD) left?.onTrigger();
  };

  const active = dx > 0 ? right : dx < 0 ? left : null;
  const armed = Math.abs(dx) > THRESHOLD;

  return (
    <div className={clsx("relative overflow-hidden rounded-2xl", className)}>
      {active && (
        <div
          className={clsx(
            "absolute inset-0 flex items-center px-5 text-sm font-semibold text-white transition-opacity",
            dx > 0 ? "justify-start" : "justify-end",
            active.className,
            armed ? "opacity-100" : "opacity-70",
          )}
        >
          <span className="flex items-center gap-2">
            {active.icon}
            {active.label}
          </span>
        </div>
      )}
      <div
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
        onTouchCancel={onEnd}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? "none" : "transform .2s ease" }}
        className="relative"
      >
        {children}
      </div>
    </div>
  );
}
