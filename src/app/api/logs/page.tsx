"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import type { Session } from "@supabase/supabase-js";
import { format, parseISO } from "date-fns";

type Row = {
  id: string;
  log_date: string;
  transcript: string | null;
  extracted: any | null;
};

function todayInIST(): string {
  const now = new Date();
  const istOffsetMin = 330;
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utc + istOffsetMin * 60000);
  return ist.toISOString().slice(0, 10);
}

export default function LogsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [to, setTo] = useState(todayInIST);
  const [from, setFrom] = useState(() => {
    const d = new Date(to + "T00:00:00");
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
  });

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) =>
      setSession(s)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  async function fetchLogs() {
    if (!session?.access_token) {
      setError("Please sign in first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const url = `/api/logs?from=${from}&to=${to}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load logs");
      setRows(json.rows ?? []);
    } catch (e: any) {
      setError(e.message || "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLogs(); /* auto-load on mount */
  }, [session]);

  const empty = !loading && !rows.length;

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-1 text-3xl font-semibold">🗂️ Your Logs</h1>
        <p className="mb-4 text-sm text-neutral-400">
          Browse entries in a date range. Click a row to expand.
        </p>

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            From:
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="ml-2 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1"
            />
          </label>
          <label className="text-sm">
            To:
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="ml-2 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1"
            />
          </label>
          <button
            onClick={fetchLogs}
            disabled={!session || loading}
            className={`rounded-md px-3 py-2 text-white ${
              !session || loading
                ? "bg-indigo-800/70"
                : "bg-indigo-600 hover:bg-indigo-500"
            }`}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-rose-700 bg-rose-900/40 p-3">
            <strong>Error:</strong> {error}
          </div>
        )}

        {empty && (
          <div className="text-neutral-400">No logs in this range.</div>
        )}

        <ul className="space-y-2">
          {rows.map((r) => (
            <details
              key={r.id}
              className="rounded-md border border-neutral-800 bg-neutral-900"
            >
              <summary className="cursor-pointer list-none px-3 py-2 hover:bg-neutral-800/50">
                <span className="font-mono text-sm text-neutral-300">
                  {r.log_date}
                </span>
                {r.extracted?.mood && (
                  <span className="ml-3 rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-200">
                    mood: {r.extracted.mood}
                  </span>
                )}
                {typeof r.extracted?.sleep_hours === "number" && (
                  <span className="ml-2 rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-200">
                    sleep: {r.extracted.sleep_hours}h
                  </span>
                )}
              </summary>
              <div className="space-y-3 border-t border-neutral-800 p-3">
                {r.transcript && (
                  <>
                    <div className="text-sm font-semibold">Transcript</div>
                    <p className="rounded-md border border-neutral-800 bg-neutral-950 p-2 leading-relaxed">
                      {r.transcript}
                    </p>
                  </>
                )}
                {r.extracted && (
                  <>
                    <div className="text-sm font-semibold">Extracted</div>
                    <pre className="overflow-x-auto rounded-md border border-neutral-800 bg-neutral-950 p-2 text-xs text-neutral-200">
                      {JSON.stringify(r.extracted, null, 2)}
                    </pre>
                  </>
                )}
              </div>
            </details>
          ))}
        </ul>
      </div>
    </main>
  );
}
