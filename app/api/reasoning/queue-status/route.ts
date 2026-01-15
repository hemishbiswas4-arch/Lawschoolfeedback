// =======================================================
// FILE: app/api/reasoning/queue-status/route.ts
// PURPOSE: Returns queue status for generation and synthesis
// =======================================================

export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { getGenerationQueueStatus, getSynthesisQueueStatus } from "@/lib/queueState"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const userId = url.searchParams.get("user_id")
  const queueType = url.searchParams.get("type") || "generation" // "generation" or "synthesis"

  if (!userId) {
    return NextResponse.json(
      { error: "Missing user_id" },
      { status: 400 }
    )
  }

  try {
    let status
    if (queueType === "generation") {
      status = getGenerationQueueStatus(userId)
    } else if (queueType === "synthesis") {
      status = getSynthesisQueueStatus(userId)
    } else {
      return NextResponse.json(
        { error: "Invalid queue type. Use 'generation' or 'synthesis'" },
        { status: 400 }
      )
    }

    return NextResponse.json(status)
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to get queue status" },
      { status: 500 }
    )
  }
}
