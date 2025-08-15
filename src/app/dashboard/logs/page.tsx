"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import type { Session } from "@supabase/supabase-js";

/** yyyy-mm-dd in IST */
function todayInIST(): string {
  const now = new Date();
  const istOffsetMin = 330;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utcMs + istOffsetMin * 60000);
  return ist.toISOString().slice(0, 10);
}
function addDays(dateISO: string, days: number) {
  const d = new Date(dateISO);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type Extracted = {
  schema_version?: number;
  sleep_hours?: number;
  mood?: string;
  energy?: number;
  focus?: number;
  highlights?: string[];
  challenges?: string[];
  gratitude?: string[];
  habits?: {
    yoga?: boolean;
    workout?: boolean;
    reading_minutes?: number;
    no_smoking?: boolean;
  };
  work?: {
    top_task_done?: string;
    time_blocks?: { label: string; minutes: number }[];
  };
  health?: {
    steps?: number;
    water_glasses?: number;
    calories?: number;
  };
  notes?: string;
  todos_tomorrow?: string[];
};

type DailyLog = {
  id: string;
  user_id: string;
  log_date: string; // stored as date in DB
  transcript: string | null;
  extracted: Extracted | null;
  created_at: string;
};

export default function LogsPage() {
  // auth
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) =>
      setSession(s)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  // date range – last 7 days to today by default
  const [from, setFrom] = useState<string>(addDays(todayInIST(), -7));
  const [to, setTo] = useState<string>(todayInIST());

  // data
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<DailyLog[]>([]);

  async function fetchLogs() {
    setLoading(true);
    setError(null);
    try {
      if (!session?.user) {
        setLogs([]);
        setError("Please sign in to see your logs.");
        return;
      }

      const { data, error } = await supabase
        .from("daily_logs")
        .select("*")
        .gte("log_date", from)
        .lte("log_date", to)
        .order("log_date", { ascending: false });

      if (error) throw error;
      setLogs(Array.isArray(data) ? (data as DailyLog[]) : []);
    } catch (e: any) {
      setLogs([]);
      setError(e?.message || "Failed to load logs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-4 text-2xl font-semibold">📂 Logs</h1>

        <div className="mb-4 flex items-center gap-3 text-sm">
          <label>
            From{" "}
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="ml-1 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-neutral-100"
            />
          </label>
          <label>
            To{" "}
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="ml-1 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-neutral-100"
            />
          </label>
          <button
            onClick={fetchLogs}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-500"
          >
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-rose-700 bg-rose-900/40 p-3">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
            Loading…
          </div>
        ) : logs.length === 0 ? (
          <div className="rounded-md border border-neutral-800 bg-neutral-900 p-4 text-neutral-400">
            No logs in this range.
          </div>
        ) : (
          <div className="space-y-6">
            {logs.map((log) => {
              const ex = (log.extracted ?? {}) as Extracted;
              const fmt = (n?: number | null) =>
                typeof n === "number" && !Number.isNaN(n) ? n : "—";
              const list = (xs?: string[]) =>
                (xs && xs.length ? xs : []).map((s, i) => (
                  <li key={i} className="list-disc pl-4">
                    {s}
                  </li>
                ));

              return (
                <div
                  key={log.id}
                  className="rounded-lg border border-neutral-800 bg-neutral-900 p-4"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div className="font-medium">{log.log_date}</div>
                    <div className="flex gap-4 text-neutral-400">
                      <div>
                        <span className="text-neutral-300">Mood:</span>{" "}
                        {ex.mood ?? "—"}
                      </div>
                      <div>
                        <span className="text-neutral-300">Energy:</span>{" "}
                        {fmt(ex.energy)}
                      </div>
                      <div>
                        <span className="text-neutral-300">Focus:</span>{" "}
                        {fmt(ex.focus)}
                      </div>
                      <div>
                        <span className="text-neutral-300">Sleep:</span>{" "}
                        {fmt(ex.sleep_hours)}
                      </div>
                      <div>
                        <span className="text-neutral-300">Top task:</span>{" "}
                        {ex.work?.top_task_done || "—"}
                      </div>
                    </div>
                  </div>

                  {/* Transcript */}
                  {log.transcript ? (
                    <div className="mb-4">
                      <div className="mb-1 text-sm font-medium text-neutral-300">
                        Transcript
                      </div>
                      <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3 leading-relaxed">
                        {log.transcript}
                      </div>
                    </div>
                  ) : null}

                  {/* Panels */}
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                      <div className="mb-1 text-sm font-medium text-neutral-300">
                        Highlights
                      </div>
                      <ul className="space-y-1 text-neutral-200">
                        {list(ex.highlights)}
                        {!ex.highlights?.length && <div>—</div>}
                      </ul>
                    </div>

                    <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                      <div className="mb-1 text-sm font-medium text-neutral-300">
                        Challenges
                      </div>
                      <ul className="space-y-1 text-neutral-200">
                        {list(ex.challenges)}
                        {!ex.challenges?.length && <div>—</div>}
                      </ul>
                    </div>

                    <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                      <div className="mb-1 text-sm font-medium text-neutral-300">
                        Gratitude
                      </div>
                      <ul className="space-y-1 text-neutral-200">
                        {list(ex.gratitude)}
                        {!ex.gratitude?.length && <div>—</div>}
                      </ul>
                    </div>

                    <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                      <div className="mb-1 text-sm font-medium text-neutral-300">
                        Habits
                      </div>
                      <div className="text-neutral-200">
                        Yoga: {ex.habits?.yoga ? "✔" : "—"}
                        {" · "}
                        Workout: {ex.habits?.workout ? "✔" : "—"}
                        {" · "}
                        No smoking: {ex.habits?.no_smoking ? "✔" : "—"}
                        {" · "}
                        Reading minutes: {fmt(ex.habits?.reading_minutes)}
                      </div>
                    </div>

                    <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                      <div className="mb-1 text-sm font-medium text-neutral-300">
                        Health
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-neutral-200">
                        <div>Steps: {fmt(ex.health?.steps)}</div>
                        <div>Water: {fmt(ex.health?.water_glasses)}</div>
                        <div>Calories: {fmt(ex.health?.calories)}</div>
                      </div>
                    </div>

                    <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                      <div className="mb-1 text-sm font-medium text-neutral-300">
                        Todos tomorrow
                      </div>
                      <ul className="space-y-1 text-neutral-200">
                        {list(ex.todos_tomorrow)}
                        {!ex.todos_tomorrow?.length && <div>—</div>}
                      </ul>
                    </div>

                    <div className="md:col-span-2 rounded-md border border-neutral-800 bg-neutral-950 p-3">
                      <div className="mb-1 text-sm font-medium text-neutral-300">
                        Notes
                      </div>
                      <div className="text-neutral-200">{ex.notes || "—"}</div>
                    </div>
                  </div>

                  {/* Raw JSON (read-only) */}
                  <div className="mt-4 rounded-md border border-neutral-800 bg-neutral-950 p-3">
                    <div className="mb-1 text-sm font-medium text-neutral-300">
                      Extracted (raw JSON)
                    </div>
                    <pre className="overflow-auto text-xs text-neutral-200">
                      {JSON.stringify(log.extracted ?? {}, null, 2)}
                    </pre>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
