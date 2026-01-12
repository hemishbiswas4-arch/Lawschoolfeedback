// =======================================================
// FILE: app/api/feedback/route.ts
// PURPOSE: Handle user feedback submissions
// =======================================================

import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

/* ================= ENV / CLIENTS ================= */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/* ================= TYPES ================= */

type FeedbackInput = {
  email?: string
  feedback_text: string
  rating?: number
  feedback_type?: string
}

/* ================= HANDLER ================= */

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as FeedbackInput
    const { email, feedback_text, rating, feedback_type } = body

    // Validate required fields
    if (!feedback_text?.trim()) {
      return NextResponse.json(
        { error: "Feedback text is required" },
        { status: 400 }
      )
    }

    // Validate rating if provided
    if (rating !== undefined && (rating < 1 || rating > 5)) {
      return NextResponse.json(
        { error: "Rating must be between 1 and 5" },
        { status: 400 }
      )
    }

    // Get client IP and user agent for analytics
    const ipAddress = req.headers.get('x-forwarded-for') ||
                     req.headers.get('x-real-ip') ||
                     'unknown'

    const userAgent = req.headers.get('user-agent') || 'unknown'

    // Insert feedback into database
    const { data, error } = await supabase
      .from('feedback')
      .insert({
        email: email?.trim() || null,
        feedback_text: feedback_text.trim(),
        rating: rating || null,
        feedback_type: feedback_type || 'general',
        user_agent: userAgent,
        ip_address: ipAddress,
      })
      .select()
      .single()

    if (error) {
      console.error('Feedback submission error:', error)
      return NextResponse.json(
        { error: "Failed to submit feedback. Please try again." },
        { status: 500 }
      )
    }

    console.log(`Feedback submitted successfully: ${data.id}`)
    return NextResponse.json({
      success: true,
      message: "Thank you for your feedback!"
    })

  } catch (err: any) {
    console.error('Feedback API error:', err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}