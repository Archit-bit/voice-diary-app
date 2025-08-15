"use client";

import React, { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import type { Session } from "@supabase/supabase-js";

/** IST yyyy-mm-dd */
function todayInIST(): string {
  const now = new Date();
  const istOffsetMin = 330;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utcMs + istOffsetMin * 60000);
  return ist.toISOString().slice(0, 10);
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
function PromptChips() {
  const prompts = [
    "One win today…",
    "One challenge…",
    "Mood (one word) & energy (1–10)…",
    "Anything you’re grateful for…",
    "What to do first tomorrow…",
  ];
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {prompts.map((p) => (
        <span
          key={p}
          className="rounded-full bg-neutral-800 px-3 py-1 text-xs text-neutral-200"
        >
          {p}
        </span>
      ))}
    </div>
  );
}

export default function Page() {
  // --- Auth
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) =>
      setSession(s)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  // --- Recorder state
  const [logDate, setLogDate] = useState(todayInIST);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    transcript?: string;
    extracted?: Extracted;
    row?: any;
  } | null>(null);
  const [chunks, setChunks] = useState<BlobPart[]>([]);
  const [durationSec, setDurationSec] = useState(0);
  const [mimeType, setMimeType] = useState<string>("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);

  // Pick supported mime type after mount
  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).MediaRecorder) {
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/ogg",
      ];
      for (const mt of candidates) {
        try {
          if ((window as any).MediaRecorder.isTypeSupported?.(mt)) {
            setMimeType(mt);
            return;
          }
        } catch {}
      }
    }
    setMimeType("");
  }, []);

  async function startRec() {
    setError(null);
    setResult(null);
    setChunks([]);
    setDurationSec(0);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Your browser doesn't support microphone access.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options: MediaRecorderOptions = mimeType ? { mimeType } : {};
      const mr = new MediaRecorder(stream, options);

      mr.ondataavailable = (e) =>
        e.data.size && setChunks((p) => [...p, e.data]);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
      };

      mr.start(1000);
      mediaRecorderRef.current = mr;
      setRecording(true);
      timerRef.current = window.setInterval(
        () => setDurationSec((d) => d + 1),
        1000
      ) as unknown as number;
    } catch (err: any) {
      setError(err?.message || "Could not access microphone.");
    }
  }

  function stopRec() {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  }

  async function processAndSave() {
    if (!chunks.length) {
      setError("No audio recorded yet.");
      return;
    }
    if (!session?.access_token) {
      setError("Please sign in first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ct = mimeType || "audio/webm";
      const blob = new Blob(chunks, { type: ct });

      const fd = new FormData();
      fd.append("audio", blob, ct.includes("ogg") ? "entry.ogg" : "entry.webm");
      fd.append("log_date", logDate);

      const res = await fetch("/api/process", {
        method: "POST",
        body: fd,
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok) setError(json?.error || "Server error");
      else setResult(json);
    } catch (err: any) {
      setError(err?.message || "Network error");
    } finally {
      setBusy(false);
    }
  }

  // --- Friendly editor helpers (controlled form bound to result.extracted)
  const extracted = result?.extracted ?? {};
  function setExtracted(next: Extracted) {
    setResult((r) => ({ ...(r ?? {}), extracted: next }));
  }

  const minutes = Math.floor(durationSec / 60);
  const seconds = durationSec % 60;

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-3xl">
        {/* Auth strip */}
        {!session ? (
          <div className="mb-4 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
            <div className="mb-2 font-semibold">Sign in to save your logs</div>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-neutral-100"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button
                className="rounded-md bg-indigo-600 px-3 py-2 text-white hover:bg-indigo-500"
                onClick={async () => {
                  const { error } = await supabase.auth.signInWithOtp({
                    email,
                    options: { emailRedirectTo: window.location.origin },
                  });
                  if (error) alert(error.message);
                  else alert("Magic link sent! Check your email.");
                }}
              >
                Send magic link
              </button>
            </div>
          </div>
        ) : (
          <div className="mb-4 flex items-center gap-3 text-sm text-neutral-400">
            <span>
              Signed in as{" "}
              <code className="text-neutral-200">{session.user.email}</code>
            </span>
            <button
              className="rounded-md bg-neutral-700 px-2 py-1 text-white hover:bg-neutral-600"
              onClick={() => supabase.auth.signOut()}
            >
              Sign out
            </button>
          </div>
        )}

        <h1 className="mb-1 text-3xl font-semibold">🎙️ Voice Diary</h1>
        <p className="mb-4 text-neutral-400">
          Speak freely — we’ll transcribe, extract key details, and save to your
          daily log.
        </p>

        <div className="mb-4 flex items-center gap-4">
          <label className="text-sm">
            Log date (IST):{" "}
            <input
              className="ml-2 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-neutral-100"
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
            />
          </label>
          <span className="text-xs text-neutral-400">
            Recording format:{" "}
            <code className="text-fuchsia-300">{mimeType || "auto"}</code>
          </span>
        </div>

        <div className="mb-4 flex items-center gap-3">
          {!recording ? (
            <button
              onClick={startRec}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-500"
            >
              Start Recording
            </button>
          ) : (
            <button
              onClick={stopRec}
              className="rounded-xl bg-rose-600 px-4 py-2 text-white hover:bg-rose-500"
            >
              Stop
            </button>
          )}
          {recording && <PromptChips />}

          <button
            onClick={processAndSave}
            disabled={!chunks.length || busy || !session}
            title={!session ? "Sign in to save" : undefined}
            className={`rounded-xl px-4 py-2 text-white ${
              !chunks.length || busy || !session
                ? "cursor-not-allowed bg-emerald-800/70"
                : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {busy ? "Processing..." : "Process & Save"}
          </button>

          <span className="ml-2 text-sm text-neutral-400">
            {recording
              ? `⏺️ ${minutes}:${seconds.toString().padStart(2, "0")}`
              : chunks.length
              ? `Recorded ${minutes}:${seconds.toString().padStart(2, "0")}`
              : ""}
          </span>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-rose-700 bg-rose-900/40 p-3">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Transcript */}
        {result?.transcript && (
          <section className="mb-6">
            <h2 className="mb-2 text-xl font-semibold">Transcript</h2>
            <p className="leading-relaxed rounded-md border border-neutral-800 bg-neutral-900 p-3">
              {result.transcript}
            </p>
          </section>
        )}

        {/* Raw JSON (optional while developing) */}
        {result?.extracted && (
          <section className="mb-6">
            <h2 className="mb-2 text-xl font-semibold">Extracted JSON</h2>
            <textarea
              defaultValue={JSON.stringify(result.extracted, null, 2)}
              onChange={(e) => {
                try {
                  setExtracted(JSON.parse(e.target.value || "{}"));
                } catch {}
              }}
              className="h-72 w-full rounded-md border border-neutral-800 bg-neutral-900 p-3 font-mono text-sm text-neutral-200"
            />
            <p className="mt-2 text-sm text-neutral-400">
              (Already saved by the server. Edit below and click{" "}
              <em>Save Changes</em> to update.)
            </p>
          </section>
        )}

        {/* Friendly editor */}
        {result?.row?.id && (
          <FriendlyEditor
            initial={extracted}
            rowId={result.row.id}
            token={session?.access_token ?? ""}
            onSaved={(next) => setExtracted(next)}
          />
        )}
      </div>
    </main>
  );
}

/* ---------------- Friendly Editor Component ---------------- */

function FriendlyEditor({
  initial,
  rowId,
  token,
  onSaved,
}: {
  initial: Extracted;
  rowId: string;
  token: string;
  onSaved: (next: Extracted) => void;
}) {
  const [form, setForm] = useState<Extracted>(() => ({
    schema_version: 1,
    highlights: [],
    challenges: [],
    gratitude: [],
    habits: {
      yoga: false,
      workout: false,
      reading_minutes: 0,
      no_smoking: false,
    },
    work: { top_task_done: "", time_blocks: [] },
    health: { steps: 0, water_glasses: 0, calories: 0 },
    todos_tomorrow: [],
    ...initial,
  }));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // helpers for list <-> textarea
  const listToText = (xs?: string[]) => (xs ?? []).join("\n");
  const textToList = (t: string) =>
    t
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/logs/${rowId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ extracted: form }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Save failed");
      setMsg("Saved!");
      onSaved(form);
    } catch (e: any) {
      setMsg(e.message || "Save failed");
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 2000);
    }
  }

  return (
    <section className="mb-16">
      <h2 className="mb-3 text-xl font-semibold">Edit fields</h2>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3">
          <label className="block text-sm text-neutral-300">Sleep hours</label>
          <input
            type="number"
            step="0.5"
            min={0}
            max={24}
            value={form.sleep_hours ?? 0}
            onChange={(e) =>
              setForm({ ...form, sleep_hours: Number(e.target.value) })
            }
            className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1"
          />
        </div>

        <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3">
          <label className="block text-sm text-neutral-300">Mood</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {["great", "good", "neutral", "low", "stressed"].map((m) => (
              <button
                key={m}
                onClick={() => setForm({ ...form, mood: m })}
                className={`rounded-full px-3 py-1 text-sm ${
                  form.mood === m
                    ? "bg-indigo-600 text-white"
                    : "bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3">
          <label className="block text-sm text-neutral-300">
            Energy: {form.energy ?? 0}
          </label>
          <input
            type="range"
            min={0}
            max={10}
            value={form.energy ?? 0}
            onChange={(e) =>
              setForm({ ...form, energy: Number(e.target.value) })
            }
            className="mt-2 w-full"
          />
        </div>

        <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3">
          <label className="block text-sm text-neutral-300">
            Focus: {form.focus ?? 0}
          </label>
          <input
            type="range"
            min={0}
            max={10}
            value={form.focus ?? 0}
            onChange={(e) =>
              setForm({ ...form, focus: Number(e.target.value) })
            }
            className="mt-2 w-full"
          />
        </div>

        <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3 md:col-span-2">
          <label className="block text-sm text-neutral-300">
            Highlights (one per line)
          </label>
          <textarea
            className="mt-1 h-28 w-full rounded-md border border-neutral-800 bg-neutral-950 p-2"
            value={listToText(form.highlights)}
            onChange={(e) =>
              setForm({ ...form, highlights: textToList(e.target.value) })
            }
          />
        </div>

        <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3 md:col-span-2">
          <label className="block text-sm text-neutral-300">
            Challenges (one per line)
          </label>
          <textarea
            className="mt-1 h-28 w-full rounded-md border border-neutral-800 bg-neutral-950 p-2"
            value={listToText(form.challenges)}
            onChange={(e) =>
              setForm({ ...form, challenges: textToList(e.target.value) })
            }
          />
        </div>

        <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3 md:col-span-2">
          <label className="block text-sm text-neutral-300">
            Gratitude (one per line)
          </label>
          <textarea
            className="mt-1 h-28 w-full rounded-md border border-neutral-800 bg-neutral-950 p-2"
            value={listToText(form.gratitude)}
            onChange={(e) =>
              setForm({ ...form, gratitude: textToList(e.target.value) })
            }
          />
        </div>

        <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3">
          <div className="mb-2 text-sm text-neutral-300">Habits</div>
          <div className="space-y-2">
            {[
              ["yoga", "Yoga"],
              ["workout", "Workout"],
              ["no_smoking", "No smoking"],
            ].map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean((form.habits as any)?.[k])}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      habits: { ...(form.habits ?? {}), [k]: e.target.checked },
                    })
                  }
                />
                {label}
              </label>
            ))}
            <label className="block text-sm">
              Reading minutes
              <input
                type="number"
                min={0}
                value={form.habits?.reading_minutes ?? 0}
                onChange={(e) =>
                  setForm({
                    ...form,
                    habits: {
                      ...(form.habits ?? {}),
                      reading_minutes: Number(e.target.value),
                    },
                  })
                }
                className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1"
              />
            </label>
          </div>
        </div>

        <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3">
          <label className="block text-sm text-neutral-300">
            Top task done
          </label>
          <input
            className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1"
            value={form.work?.top_task_done ?? ""}
            onChange={(e) =>
              setForm({
                ...form,
                work: { ...(form.work ?? {}), top_task_done: e.target.value },
              })
            }
          />
        </div>

        <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3">
          <label className="block text-sm text-neutral-300">Health</label>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[
              ["steps", "Steps"],
              ["water_glasses", "Water"],
              ["calories", "Calories"],
            ].map(([k, label]) => (
              <label key={k} className="text-xs">
                {label}
                <input
                  type="number"
                  min={0}
                  value={(form.health as any)?.[k] ?? 0}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      health: {
                        ...(form.health ?? {}),
                        [k]: Number(e.target.value),
                      },
                    })
                  }
                  className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3 md:col-span-2">
          <label className="block text-sm text-neutral-300">Notes</label>
          <textarea
            className="mt-1 h-28 w-full rounded-md border border-neutral-800 bg-neutral-950 p-2"
            value={form.notes ?? ""}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3 md:col-span-2">
          <label className="block text-sm text-neutral-300">
            Todos tomorrow (one per line)
          </label>
          <textarea
            className="mt-1 h-28 w-full rounded-md border border-neutral-800 bg-neutral-950 p-2"
            value={listToText(form.todos_tomorrow)}
            onChange={(e) =>
              setForm({ ...form, todos_tomorrow: textToList(e.target.value) })
            }
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={!token || saving}
          className={`rounded-md px-4 py-2 text-white ${
            !token || saving
              ? "cursor-not-allowed bg-indigo-800/70"
              : "bg-indigo-600 hover:bg-indigo-500"
          }`}
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
        {msg && <span className="text-sm text-neutral-400">{msg}</span>}
      </div>
    </section>
  );
}
