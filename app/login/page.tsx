"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Login failed.");

      const destination = new URLSearchParams(window.location.search).get("next");
      router.replace(destination?.startsWith("/") ? destination : "/");
      router.refresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-white">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl">
        <p className="text-xs uppercase tracking-[0.25em] text-cyan-300">WAHA Proxy</p>
        <h1 className="mt-3 text-2xl font-semibold">Dashboard login</h1>
        <p className="mt-2 text-sm text-white/55">Enter the dashboard password to continue.</p>

        <label className="mt-6 block text-sm text-white/75" htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-2 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 outline-none focus:border-cyan-400"
        />
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        <button disabled={loading} className="mt-5 w-full rounded-lg bg-cyan-500 px-4 py-2 font-medium text-slate-950 disabled:opacity-50">
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
