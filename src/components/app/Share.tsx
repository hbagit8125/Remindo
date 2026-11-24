"use client";

import { useState } from "react";
import { Copy, Send, Share2 } from "lucide-react";
import { useToast } from "./toast";
import { Modal } from "@/components/screens/MoneyPlus";

/**
 * Share a short text (a list, a payment reminder) via WhatsApp, Telegram, the phone's
 * share menu, or copy. Nothing is sent by Remindo itself: the chosen app opens with the
 * message ready, and you pick who gets it.
 */
export function ShareButton({ text, title, label = "Share", className }: { text: string; title: string; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} aria-label={label || title}>
        <Share2 className="h-4 w-4" />
        {label && <span>{label}</span>}
      </button>
      {open && <ShareSheet text={text} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareSheet({ text, title, onClose }: { text: string; title: string; onClose: () => void }) {
  const { toast } = useToast();
  const [msg, setMsg] = useState(text);
  const enc = encodeURIComponent(msg);
  const go = (url: string) => {
    window.open(url, "_blank", "noopener");
    onClose();
  };
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const btn = "flex flex-col items-center gap-1.5 rounded-2xl border border-line py-3 text-xs font-medium hover:bg-raised";
  return (
    <Modal title={title} onClose={onClose}>
      <textarea
        rows={Math.min(10, Math.max(3, msg.split("\n").length + 1))}
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        className="mb-4 w-full rounded-2xl border border-line bg-raised p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
      />
      <div className="grid grid-cols-4 gap-2">
        <button className={btn} onClick={() => go(`https://wa.me/?text=${enc}`)}>
          <span className="grid h-9 w-9 place-items-center rounded-full bg-[#25D366] text-lg text-white">✆</span>
          WhatsApp
        </button>
        <button className={btn} onClick={() => go(`https://t.me/share/url?url=${encodeURIComponent(" ")}&text=${enc}`)}>
          <span className="grid h-9 w-9 place-items-center rounded-full bg-[#229ED9] text-white">
            <Send className="h-4 w-4" />
          </span>
          Telegram
        </button>
        <button
          className={btn}
          disabled={!canShare}
          onClick={() =>
            navigator
              .share({ text: msg })
              .then(onClose)
              .catch(() => null)
          }
        >
          <span className="grid h-9 w-9 place-items-center rounded-full bg-raised">
            <Share2 className="h-4 w-4" />
          </span>
          More
        </button>
        <button
          className={btn}
          onClick={() =>
            navigator.clipboard
              .writeText(msg)
              .then(() => {
                toast({ message: "Copied" });
                onClose();
              })
              .catch(() => toast({ message: "Couldn't copy", tone: "error" }))
          }
        >
          <span className="grid h-9 w-9 place-items-center rounded-full bg-raised">
            <Copy className="h-4 w-4" />
          </span>
          Copy
        </button>
      </div>
      <p className="mt-3 text-xs text-muted">You can edit the message first. The app opens with it ready; you choose who to send it to.</p>
    </Modal>
  );
}

/** Friendly text for a due. */
export function dueShareText(d: { person: string; direction: string; amountPaise: number; note: string | null }) {
  const amt = `₹${(d.amountPaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const first = d.person.split(" ")[0];
  return d.direction === "they_owe"
    ? `Hi ${first}, just a gentle reminder about the ${amt}${d.note ? ` for ${d.note}` : ""}. You can send it whenever you get a chance. Thanks! 🙂`
    : `Hi ${first}, I haven't forgotten the ${amt} I owe you${d.note ? ` for ${d.note}` : ""}. I'll send it soon. Thanks for your patience! 🙂`;
}

/** Plain-text list: open items first, ticked ones marked. */
export function listShareText(l: { name: string; emoji: string | null; kind: string; body: string | null; items: { text: string; done: boolean }[] }) {
  const head = `${l.emoji ? `${l.emoji} ` : ""}${l.name}`;
  if (l.kind === "note") return `${head}\n\n${l.body || ""}`.trim();
  const open = l.items.filter((i) => !i.done).map((i) => `• ${i.text}`);
  const done = l.items.filter((i) => i.done).map((i) => `✓ ${i.text}`);
  return [head, "", ...open, ...(done.length ? ["", ...done] : [])].join("\n").trim();
}
