import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const password = searchParams.get("password")

  if (!password || password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // Get all usage logs with aggregated stats
    const { data: usageLogs, error } = await supabase
      .from("usage_logs")
      .select("*")
      .order("last_used_at", { ascending: false })

    if (error) {
      console.error("Error fetching usage logs:", error)
      return NextResponse.json({ error: "Failed to fetch usage data" }, { status: 500 })
    }

    // Calculate statistics
    const totalUsers = new Set(usageLogs?.map(log => log.user_id) || []).size
    const totalUsage = usageLogs?.reduce((sum, log) => sum + log.usage_count, 0) || 0

    const featureUsage: Record<string, number> = {}
    usageLogs?.forEach(log => {
      featureUsage[log.feature] = (featureUsage[log.feature] || 0) + log.usage_count
    })

    // Group by user for detailed stats
    const userMap = new Map<string, any>()
    usageLogs?.forEach(log => {
      if (!userMap.has(log.user_id)) {
        userMap.set(log.user_id, {
          user_id: log.user_id,
          user_email: log.user_email,
          total_usage: 0,
          features_used: {},
          last_used_at: log.last_used_at
        })
      }

      const user = userMap.get(log.user_id)
      user.total_usage += log.usage_count
      user.features_used[log.feature] = (user.features_used[log.feature] || 0) + log.usage_count

      // Update last_used_at if this log is more recent
      if (new Date(log.last_used_at) > new Date(user.last_used_at)) {
        user.last_used_at = log.last_used_at
      }
    })

    const userDetails = Array.from(userMap.values()).sort((a, b) =>
      new Date(b.last_used_at).getTime() - new Date(a.last_used_at).getTime()
    )

    return NextResponse.json({
      totalUsers,
      totalUsage,
      featureUsage,
      userDetails
    })

  } catch (error) {
    console.error("Error in usage API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}