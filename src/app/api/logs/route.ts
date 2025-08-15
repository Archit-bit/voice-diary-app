import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(req: NextRequest) {
  const supabase = createClient(url, anon, {
    global: {
      headers: { Authorization: req.headers.get("Authorization") ?? "" },
    },
  });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json({ error: "from/to required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("daily_logs") // 🔁 switched from voice_logs
    .select("*")
    .gte("log_date", from)
    .lte("log_date", to)
    .order("log_date", { ascending: true });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ data });
}
