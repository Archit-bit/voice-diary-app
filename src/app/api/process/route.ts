// app/api/process/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/** IST yyyy-mm-dd */
function todayInIST(): string {
  const now = new Date();
  const istOffsetMin = 330; // +05:30
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utc + istOffsetMin * 60000);
  return ist.toISOString().slice(0, 10);
}

/** 1) Deepgram STT */
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
        "Content-Type": body.type || "application/octet-stream",
      },
      body,
    }
  );
  if (!res.ok) throw new Error(`Deepgram failed: ${await res.text()}`);

  const j = await res.json();
  const transcript =
    j?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
  return transcript;
}

/** 2) JSON schema for extraction (strict mode requires additionalProperties:false and required lists) */
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

/** 3) OpenAI extraction via Responses API with json_schema formatter */
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
      text: {
        format: {
          type: "json_schema",
          name: "daily_log",
          schema: extractionSchema,
          strict: true,
        },
      },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI failed: ${await res.text()}`);
  const j = await res.json();

  const jsonText =
    (Array.isArray(j?.output) &&
      Array.isArray(j.output[0]?.content) &&
      j.output[0].content.find((c: any) => c?.type === "output_text")?.text) ||
    (typeof j?.output_text === "string" ? j.output_text : "");

  const parsed = jsonText ? JSON.parse(jsonText) : {};
  if (!parsed.schema_version) parsed.schema_version = 1;
  return parsed;
}

/** 4) Main handler */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();

    // Validate we actually received a file
    const filePart = form.get("audio");
    if (!(filePart instanceof File)) {
      return NextResponse.json(
        { error: "audio must be a file upload (Blob/File)" },
        { status: 400 }
      );
    }
    const file = filePart as File;

    const logDate = (form.get("log_date") as string) || todayInIST();

    // Prepare audio for Deepgram
    const arrayBuffer = await file.arrayBuffer();
    const contentType = file.type || "application/octet-stream";

    // 1) STT
    const transcript = await transcribeWithDeepgram(arrayBuffer, contentType);

    // 2) Extract JSON
    const extracted = await extractWithOpenAI(transcript);

    // 3) Supabase client with caller's JWT (RLS-friendly)
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // 4) Get the authenticated user id from JWT
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return NextResponse.json(
        { error: "Unauthorized (no session)" },
        { status: 401 }
      );
    }
    const userId = userData.user.id;

    // 5) Upsert row (RLS policies must allow owner access)
    const { data, error } = await supabase
      .from("daily_logs")
      .upsert(
        { user_id: userId, log_date: logDate, transcript, extracted },
        { onConflict: "user_id,log_date" }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ transcript, extracted, row: data });
  } catch (e: any) {
    console.error("[/api/process] ERROR:", e);
    return NextResponse.json({ error: e.message ?? "failed" }, { status: 500 });
  }
}
