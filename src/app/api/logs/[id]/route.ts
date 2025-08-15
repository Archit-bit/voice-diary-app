// src/app/api/logs/[id]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type RouteParams = { id: string };
type RouteContext = { params: RouteParams };

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = context.params;

  try {
    const body = (await req.json()) as { extracted?: unknown };

    const { data, error } = await supabase
      .from("daily_logs")
      .update({ extracted: body.extracted })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ row: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
