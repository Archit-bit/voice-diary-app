"use client";
import React, { useEffect, useRef, useState } from "react";

/** Compute today in IST as YYYY-MM-DD so late-night entries don't shift */
function todayInIST(): string {
  const now = new Date();
  const istOffsetMin = 330; // +05:30
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utcMs + istOffsetMin * 60000);
  return ist.toISOString().slice(0, 10);
}

export default function Page() {
  const [logDate, setLogDate] = useState(todayInIST);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [chunks, setChunks] = useState<BlobPart[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [mimeType, setMimeType] = useState<string>(""); // ← computed after mount
  const [defaultUserId, setDefaultUserId] = useState<string>("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);

  // Compute values that need window/navigator only on the client
  useEffect(() => {
    // read test user id from env (exposed with NEXT_PUBLIC_)
    setDefaultUserId(process.env.NEXT_PUBLIC_DEFAULT_USER_ID || "");

    // find a supported audio mime type
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
        } catch {
          // ignore and continue
        }
      }
    }
    setMimeType(""); // let browser decide if none matched
  }, []);

  async function startRec() {
    setError(null);
    setResult(null);
    setChunks([]);
    setDurationSec(0);

    try {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        setError("Your browser doesn't support microphone access.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const options: MediaRecorderOptions = mimeType ? { mimeType } : {};
      const mr = new MediaRecorder(stream, options);

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) setChunks((prev) => [...prev, e.data]);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop()); // release mic
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
      };

      mr.start(1000); // emit a chunk every second
      mediaRecorderRef.current = mr;
      setRecording(true);

      // simple duration timer
      timerRef.current = window.setInterval(() => {
        setDurationSec((d) => d + 1);
      }, 1000) as unknown as number;
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
    setBusy(true);
    setError(null);
    try {
      const contentType = mimeType || "audio/webm"; // hint for server/Deepgram
      const blob = new Blob(chunks, { type: contentType });

      const fd = new FormData();
      fd.append(
        "audio",
        blob,
        contentType.includes("ogg") ? "entry.ogg" : "entry.webm"
      );
      fd.append("log_date", logDate);

      // ✅ include a user_id until we wire real auth
      if (defaultUserId) {
        fd.append("user_id", defaultUserId);
      }

      const res = await fetch("/api/process", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Server error");
      } else {
        setResult(json);
      }
    } catch (err: any) {
      setError(err?.message || "Network error");
    } finally {
      setBusy(false);
    }
  }

  const minutes = Math.floor(durationSec / 60);
  const seconds = durationSec % 60;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0b0b0c",
        color: "#e5e7eb",
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 6 }}>
          🎙️ Voice Diary
        </h1>
        <p style={{ color: "#9ca3af", marginBottom: 16 }}>
          Speak freely — we’ll transcribe, extract key details, and save to your
          daily log.
        </p>

        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <label style={{ fontSize: 14 }}>
            Log date (IST):{" "}
            <input
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              style={{
                background: "#111827",
                border: "1px solid #1f2937",
                borderRadius: 8,
                padding: "6px 8px",
                color: "#e5e7eb",
                marginLeft: 8,
              }}
            />
          </label>
          <span style={{ fontSize: 12, color: "#a1a1aa" }}>
            Recording format:{" "}
            <code style={{ color: "#c084fc" }}>{mimeType || "auto"}</code>
          </span>
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          {!recording ? (
            <button
              onClick={startRec}
              style={{
                padding: "10px 16px",
                borderRadius: 12,
                background: "#4f46e5",
                border: 0,
                color: "white",
              }}
            >
              Start Recording
            </button>
          ) : (
            <button
              onClick={stopRec}
              style={{
                padding: "10px 16px",
                borderRadius: 12,
                background: "#dc2626",
                border: 0,
                color: "white",
              }}
            >
              Stop
            </button>
          )}
          <button
            onClick={processAndSave}
            disabled={!chunks.length || busy}
            style={{
              padding: "10px 16px",
              borderRadius: 12,
              background: busy || !chunks.length ? "#064e3b" : "#059669",
              opacity: busy || !chunks.length ? 0.6 : 1,
              border: 0,
              color: "white",
            }}
          >
            {busy ? "Processing..." : "Process & Save"}
          </button>

          <span style={{ fontSize: 14, color: "#a1a1aa", marginLeft: 8 }}>
            {recording
              ? `⏺️ ${minutes}:${seconds.toString().padStart(2, "0")}`
              : chunks.length
              ? `Recorded ${minutes}:${seconds.toString().padStart(2, "0")}`
              : ""}
          </span>
        </div>

        {error && (
          <div
            style={{
              marginBottom: 16,
              padding: 12,
              borderRadius: 8,
              background: "#3f1d1d",
              border: "1px solid #7f1d1d",
            }}
          >
            <strong>Error:</strong> {error}
          </div>
        )}

        {result?.transcript && (
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
              Transcript
            </h2>
            <p
              style={{
                padding: 12,
                borderRadius: 8,
                background: "#111827",
                border: "1px solid #1f2937",
                lineHeight: 1.6,
              }}
            >
              {result.transcript}
            </p>
          </section>
        )}

        {result?.extracted && (
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
              Extracted JSON
            </h2>
            <textarea
              defaultValue={JSON.stringify(result.extracted, null, 2)}
              onChange={(e) => {
                try {
                  const next = JSON.parse(e.target.value || "{}");
                  setResult((r: any) => ({ ...r, extracted: next }));
                } catch {
                  /* ignore parse errors in UI */
                }
              }}
              style={{
                width: "100%",
                height: 320,
                padding: 12,
                borderRadius: 8,
                background: "#111827",
                border: "1px solid #1f2937",
                color: "#d1d5db",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                fontSize: 13,
              }}
            />
            <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
              (It’s already saved by the server. We’ll add an edit/save route
              next.)
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
