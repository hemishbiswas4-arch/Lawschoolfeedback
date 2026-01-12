// =======================================================
// FILE: app/api/admin/feedback/route.ts
// PURPOSE: Admin API for viewing feedback data
// =======================================================

import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

/* ================= ENV / CLIENTS ================= */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ADMIN_PASSWORD = "hadesfudge"

/* ================= TYPES ================= */

type FeedbackItem = {
  id: string
  email: string | null
  feedback_text: string
  rating: number | null
  feedback_type: string
  user_agent: string | null
  ip_address: string | null
  created_at: string
  updated_at: string
}

/* ================= UTILS ================= */

function authenticateAdmin(request: Request): boolean {
  // Check for password in Authorization header (Basic auth)
  const authHeader = request.headers.get('authorization')
  if (authHeader && authHeader.startsWith('Basic ')) {
    const base64Credentials = authHeader.slice(6)
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii')
    const [username, password] = credentials.split(':')
    return password === ADMIN_PASSWORD
  }

  // Check for password in query parameter (for GET requests)
  const url = new URL(request.url)
  const password = url.searchParams.get('password')
  return password === ADMIN_PASSWORD
}

/* ================= HANDLER ================= */

export async function GET(req: Request) {
  try {
    // Authenticate admin
    if (!authenticateAdmin(req)) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    // Parse query parameters for filtering
    const url = new URL(req.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100) // Max 100
    const offset = parseInt(url.searchParams.get('offset') || '0')
    const feedbackType = url.searchParams.get('type')
    const hasRating = url.searchParams.get('has_rating') === 'true'
    const sortBy = url.searchParams.get('sort') || 'created_at'
    const sortOrder = url.searchParams.get('order') === 'asc' ? 'asc' : 'desc'

    // Build query
    let query = supabase
      .from('feedback')
      .select('*', { count: 'exact' })

    // Apply filters
    if (feedbackType) {
      query = query.eq('feedback_type', feedbackType)
    }

    if (hasRating) {
      query = query.not('rating', 'is', null)
    }

    // Apply sorting
    const validSortFields = ['created_at', 'rating', 'feedback_type']
    if (validSortFields.includes(sortBy)) {
      query = query.order(sortBy, { ascending: sortOrder === 'asc' })
    } else {
      query = query.order('created_at', { ascending: false })
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    const { data: feedback, error, count } = await query

    if (error) {
      console.error('Feedback fetch error:', error)
      return NextResponse.json(
        { error: "Failed to fetch feedback" },
        { status: 500 }
      )
    }

    // Get feedback statistics
    const { data: stats } = await supabase
      .from('feedback')
      .select('rating, feedback_type')
      .not('rating', 'is', null)

    const ratingStats = stats?.reduce((acc, item) => {
      if (item.rating) {
        acc[item.rating] = (acc[item.rating] || 0) + 1
      }
      return acc
    }, {} as Record<number, number>) || {}

    const typeStats = stats?.reduce((acc, item) => {
      acc[item.feedback_type] = (acc[item.feedback_type] || 0) + 1
      return acc
    }, {} as Record<string, number>) || {}

    return NextResponse.json({
      feedback: feedback || [],
      total: count || 0,
      stats: {
        ratings: ratingStats,
        types: typeStats,
        averageRating: stats?.length ?
          (stats.reduce((sum, item) => sum + (item.rating || 0), 0) / stats.filter(s => s.rating).length) : 0
      },
      pagination: {
        limit,
        offset,
        hasMore: count ? (offset + limit) < count : false
      }
    })

  } catch (err: any) {
    console.error('Admin feedback API error:', err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}