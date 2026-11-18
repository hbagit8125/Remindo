"use client";

import { useState } from "react";
import { AlarmClock, ArrowRight, Loader2 } from "lucide-react";

export default function LoginPage() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    if (res.ok) {
      window.location.href = "/";
    } else {
      setError((await res.json().catch(() => ({}))).error || "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <form onSubmit={submit} className="glass w-full max-w-sm rounded-3xl p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-pink-500">
            <AlarmClock className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">Remindo</h1>
            <p className="text-sm text-zinc-400">Enter your passcode</p>
          </div>
        </div>
        <input
          type="password"
          autoFocus
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="Passcode"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-zinc-500 focus:border-indigo-400"
        />
        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
        <button
          disabled={loading || !passcode}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 font-semibold text-zinc-900 transition hover:bg-zinc-200 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Unlock <ArrowRight className="h-4 w-4" /></>}
        </button>
      </form>
    </main>
  );
}
