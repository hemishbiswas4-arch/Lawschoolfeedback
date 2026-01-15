// =======================================================
// FILE: app/api/sources/[sourceId]/chunks/route.ts
// =======================================================

import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  const url = new URL(req.url)
  const segments = url.pathname.split("/")
  const sourceId = segments[segments.indexOf("sources") + 1]

  if (!sourceId) {
    return NextResponse.json(
      { error: "Missing sourceId" },
      { status: 400 }
    )
  }

  // Get user_id from query params or headers
  const userId = url.searchParams.get("user_id")
  if (!userId) {
    return NextResponse.json(
      { error: "Authentication required. Missing user_id." },
      { status: 401 }
    )
  }

  // Verify source ownership via project ownership
  const { data: sourceCheck, error: sourceError } = await supabaseAdmin
    .from("project_sources")
    .select(`
      id,
      project_id,
      projects!inner(owner_id)
    `)
    .eq("id", sourceId)
    .eq("projects.owner_id", userId)
    .single()

  if (sourceError || !sourceCheck) {
    return NextResponse.json(
      { error: "Source not found or access denied" },
      { status: 403 }
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
    console.error("❌ source_chunks fetch failed:", error)
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json(data ?? [])
}
