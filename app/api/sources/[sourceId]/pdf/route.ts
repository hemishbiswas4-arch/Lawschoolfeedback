// =======================================================
// FILE: app/api/sources/[sourceId]/pdf/route.ts
// =======================================================

import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  // Extract sourceId from URL path
  const url = new URL(req.url)
  const segments = url.pathname.split("/")
  const sourceId = segments[segments.indexOf("sources") + 1]

  if (!sourceId) {
    return NextResponse.json(
      { error: "Missing sourceId" },
      { status: 400 }
    )
  }

  const { data: source, error } = await supabaseAdmin
    .from("project_sources")
    .select("storage_path")
    .eq("id", sourceId)
    .single()

  if (error || !source) {
    return NextResponse.json(
      { error: "Source not found" },
      { status: 404 }
    )
  }

  const { data, error: signError } =
    await supabaseAdmin.storage
      .from("sources")
      .createSignedUrl(source.storage_path, 60 * 10)

  if (signError || !data?.signedUrl) {
    return NextResponse.json(
      { error: "Failed to sign URL" },
      { status: 500 }
    )
  }

  return NextResponse.json({ url: data.signedUrl })
}
