"use client";

import { clsx } from "clsx";
import { Eye, EyeOff } from "lucide-react";
import { useHideAmounts } from "./privacy";

/** The eye button: hide / show every amount. */
export function HideAmountsButton({ className, withLabel }: { className?: string; withLabel?: boolean }) {
  const { hidden, toggle } = useHideAmounts();
  return (
    <button
      onClick={toggle}
      aria-label={hidden ? "Show amounts" : "Hide amounts"}
      aria-pressed={hidden}
      title={hidden ? "Show amounts" : "Hide amounts"}
      className={clsx(className ?? "grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-raised")}
    >
      {hidden ? <EyeOff className={withLabel ? "h-[18px] w-[18px]" : "h-5 w-5"} /> : <Eye className={withLabel ? "h-[18px] w-[18px]" : "h-5 w-5"} />}
      {withLabel && (hidden ? "Show amounts" : "Hide amounts")}
    </button>
  );
}
