// app/api/process/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs"; // Ensure Node runtime (we need Buffers/SDKs)

/** Helper: get today's date string in IST (Asia/Kolkata) like "2025-08-13" */
function todayInIST(): string {
  const now = new Date();
  const istOffsetMin = 330; // +05:30
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utc + istOffsetMin * 60000);
  return ist.toISOString().slice(0, 10);
}

/** 1) Send audio bytes to Deepgram for transcription */
async function transcribeWithDeepgram(bytes: ArrayBuffer, contentType: string) {
  const body = new Blob([bytes], {
    type: contentType || "application/octet-stream",
  });

  const res = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY!}`,
        // Do NOT set Content-Type yourself when sending a Blob unless you’re sure.
        // Here we are sure, so it’s okay to set it to the file’s MIME:
        "Content-Type": body.type || "application/octet-stream",
      },
      body, // Blob is valid BodyInit
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Deepgram failed: ${t}`);
  }
  const j = await res.json();
  const transcript =
    j?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
  return transcript;
}

/** JSON schema we want the LLM to output */
// Looser, iteration-friendly schema
const extractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schema_version: { type: "number" },
    sleep_hours: { type: "number" },
    mood: { type: "string" },
    energy: { type: "number" },
    focus: { type: "number" },
    highlights: { type: "array", items: { type: "string" } },
    challenges: { type: "array", items: { type: "string" } },
    gratitude: { type: "array", items: { type: "string" } },

    habits: {
      type: "object",
      additionalProperties: false,
      properties: {
        yoga: { type: "boolean" },
        workout: { type: "boolean" },
        reading_minutes: { type: "number" },
        no_smoking: { type: "boolean" },
      },
      required: ["yoga", "workout", "reading_minutes", "no_smoking"],
    },

    work: {
      type: "object",
      additionalProperties: false,
      properties: {
        top_task_done: { type: "string" },
        time_blocks: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { type: "string" },
              minutes: { type: "number" },
            },
            required: ["label", "minutes"],
          },
        },
      },
      required: ["top_task_done", "time_blocks"],
    },

    health: {
      type: "object",
      additionalProperties: false,
      properties: {
        steps: { type: "number" },
        water_glasses: { type: "number" },
        calories: { type: "number" },
      },
      required: ["steps", "water_glasses", "calories"],
    },

    notes: { type: "string" },
    todos_tomorrow: { type: "array", items: { type: "string" } },
  },
  required: [
    "schema_version",
    "sleep_hours",
    "mood",
    "energy",
    "focus",
    "highlights",
    "challenges",
    "gratitude",
    "habits",
    "work",
    "health",
    "notes",
    "todos_tomorrow",
  ],
} as const;

/** 2) Send transcript to OpenAI for structured JSON extraction */
async function extractWithOpenAI(transcript: string) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content:
            "You extract structured daily journal data. Return ONLY JSON that conforms to the provided JSON schema.",
        },
        {
          role: "user",
          content:
            `Schema: ${JSON.stringify(extractionSchema)}\n\n` +
            "Rules:\n" +
            "- Infer numbers from phrases (e.g., 'about seven and a half hours' → 7.5)\n" +
            "- Omit fields not mentioned\n" +
            "- mood: single lowercase word when possible\n" +
            "- notes: 1–3 short sentences\n\n" +
            `Transcript:\n${transcript}`,
        },
      ],
      // ✅ Correct formatter shape for Responses API
      text: {
        format: {
          type: "json_schema",
          name: "daily_log",
          schema: extractionSchema, // <-- schema lives directly here
          strict: true,
        },
      },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI failed: ${t}`);
  }

  const j = await res.json();

  // Pull the JSON string from the Responses output (covers common shapes)
  const fromOutputArray =
    Array.isArray(j?.output) &&
    Array.isArray(j.output[0]?.content) &&
    j.output[0].content.find((c: any) => c?.type === "output_text")?.text;

  const jsonText =
    fromOutputArray ??
    (typeof j?.output_text === "string" ? j.output_text : "");

  const parsed = jsonText ? JSON.parse(jsonText) : {};
  if (!parsed.schema_version) parsed.schema_version = 1;
  return parsed;
}

/** 3) Save to Supabase (upsert by user_id + log_date) */
async function upsertDailyLog({
  userId,
  logDate,
  transcript,
  extracted,
}: {
  userId: string;
  logDate: string;
  transcript: string;
  extracted: any;
}) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE!
  );

  const { data, error } = await supabase
    .from("daily_logs")
    .upsert(
      { user_id: userId, log_date: logDate, transcript, extracted },
      { onConflict: "user_id,log_date" }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function POST(req: NextRequest) {
  try {
    // Receive multipart/form-data from the browser
    const form = await req.formData();
    const file = form.get("audio") as File | null;
    let logDate = (form.get("log_date") as string) || todayInIST();
    const userId =
      (form.get("user_id") as string) || process.env.DEFAULT_USER_ID!;

    if (!file) {
      return NextResponse.json({ error: "audio missing" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();

    // Some browsers will set "audio/webm"; leave as-is; Deepgram accepts webm/opus or wav
    const contentType = file.type || "application/octet-stream";

    const transcript = await transcribeWithDeepgram(arrayBuffer, contentType);
    const extracted = await extractWithOpenAI(transcript);
    const row = await upsertDailyLog({
      userId,
      logDate,
      transcript,
      extracted,
    });

    return NextResponse.json({ transcript, extracted, row });
  } catch (e: any) {
    // Basic server-side logging (appears in your dev terminal / Vercel logs)
    console.error("[/api/process] ERROR:", e);
    return NextResponse.json({ error: e.message ?? "failed" }, { status: 500 });
  }
}
