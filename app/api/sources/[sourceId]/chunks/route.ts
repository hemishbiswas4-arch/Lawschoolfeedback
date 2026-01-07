// @/app/api/sources/[sourceId]/chunks/route.ts

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  _req: NextRequest,
  context: { params: { sourceId: string } }
) {
  const { sourceId } = context.params

  if (!sourceId) {
    return NextResponse.json(
      { error: "Missing sourceId" },
      { status: 400 }
    )
  }

  const { data, error } = await supabaseAdmin
    .from("source_chunks")
    .select(`
      id,
      text,
      page_number,
      paragraph_index,
      chunk_index,
      rects_json
    `)
    .eq("source_id", sourceId)
    .order("chunk_index", { ascending: true })

  if (error) {
    console.error("CHUNKS ❌ fetch failed", error)
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json(data ?? [])
}
