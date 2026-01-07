// ===============================
// FILE: app/api/sources/[sourceId]/pdf/route.ts
// ===============================

export const runtime = "nodejs"

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

  console.log("📄 /api/sources/[sourceId]/pdf → sourceId:", sourceId)

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
    console.error("❌ Source lookup failed", error)
    return NextResponse.json(
      { error: "Source not found" },
      { status: 404 }
    )
  }

  const { data, error: signError } = await supabaseAdmin.storage
    .from("sources")
    .createSignedUrl(source.storage_path, 60 * 10)

  if (signError || !data?.signedUrl) {
    console.error("❌ Signed URL creation failed", signError)
    return NextResponse.json(
      { error: "Failed to sign URL" },
      { status: 500 }
    )
  }

  console.log("🔑 Signed URL generated")

  return NextResponse.json({ url: data.signedUrl })
}
