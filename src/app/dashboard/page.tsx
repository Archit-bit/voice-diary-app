"use client";
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import type { Session } from "@supabase/supabase-js";

type Point = { x: string; y: number };

function todayISO(n = 0) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function Dashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [from, setFrom] = useState(todayISO(-30));
  const [to, setTo] = useState(todayISO(0));
  const [sleep, setSleep] = useState<Point[]>([]);
  const [energy, setEnergy] = useState<Point[]>([]);
  const [focus, setFocus] = useState<Point[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSession(s)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  async function load() {
    if (!session) {
      setErr("Please sign in to see your dashboard.");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from("daily_logs")
        .select("log_date, extracted")
        .gte("log_date", from)
        .lte("log_date", to)
        .order("log_date", { ascending: true });

      if (error) throw error;

      const s: Point[] = [];
      const e: Point[] = [];
      const f: Point[] = [];

      for (const row of data ?? []) {
        const ex = (row as any).extracted ?? {};
        if (typeof ex.sleep_hours === "number")
          s.push({ x: row.log_date, y: ex.sleep_hours });
        if (typeof ex.energy === "number")
          e.push({ x: row.log_date, y: ex.energy });
        if (typeof ex.focus === "number")
          f.push({ x: row.log_date, y: ex.focus });
      }
      setSleep(s);
      setEnergy(e);
      setFocus(f);
    } catch (e: any) {
      setErr(e.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session) load();
  }, [session]);

  const Chart = useMemo(
    () =>
      function Chart({ title, data }: { title: string; data: Point[] }) {
        return (
          <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3">
            <div className="mb-2 text-sm text-neutral-300">{title}</div>
            {data.length === 0 ? (
              <div className="py-12 text-center text-sm text-neutral-500">
                No data
              </div>
            ) : (
              <ul className="space-y-1 text-xs text-neutral-300">
                {data.map((p) => (
                  <li key={p.x} className="flex justify-between">
                    <span>{p.x}</span>
                    <span>{p.y}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      },
    []
  );

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-3 text-2xl font-semibold">📈 Dashboard</h1>

        {!session && (
          <div className="mb-4 rounded-md border border-yellow-800 bg-yellow-900/30 p-3 text-sm">
            You’re not signed in. Go to{" "}
            <a href="/" className="underline">
              Record
            </a>{" "}
            and sign in first.
          </div>
        )}

        {err && (
          <div className="mb-4 rounded-md border border-rose-700 bg-rose-900/40 p-3 text-sm">
            {err}
          </div>
        )}

        <div className="mb-4 flex items-center gap-3 text-sm">
          <label>
            From{" "}
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="ml-1 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1"
            />
          </label>
          <label>
            To{" "}
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="ml-1 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1"
            />
          </label>
          <button
            onClick={load}
            disabled={!session || loading}
            className={`rounded-md px-3 py-1 text-white ${
              !session || loading
                ? "bg-indigo-800/70"
                : "bg-indigo-600 hover:bg-indigo-500"
            }`}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Chart title="🛌 Sleep (hrs)" data={sleep} />
          <Chart title="⚡️ Energy (0–10)" data={energy} />
          <div className="md:col-span-2">
            <Chart title="🎯 Focus (0–10)" data={focus} />
          </div>
        </div>
      </div>
    </main>
  );
}
