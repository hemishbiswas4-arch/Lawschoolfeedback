"use client"

import { useState, useEffect } from "react"
import Link from "next/link"

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

type FeedbackStats = {
  ratings: Record<number, number>
  types: Record<string, number>
  averageRating: number
}

type UsageStats = {
  totalUsers: number
  totalUsage: number
  featureUsage: Record<string, number>
  userDetails: Array<{
    user_id: string
    user_email: string
    total_usage: number
    features_used: Record<string, number>
    last_used_at: string
  }>
}

type FeedbackResponse = {
  feedback: FeedbackItem[]
  total: number
  stats: FeedbackStats
  pagination: {
    limit: number
    offset: number
    hasMore: boolean
  }
}

/* ================= COMPONENT ================= */

export default function AdminFeedbackPage() {
  const [password, setPassword] = useState("")
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [authError, setAuthError] = useState("")

  const [feedback, setFeedback] = useState<FeedbackItem[]>([])
  const [stats, setStats] = useState<FeedbackStats | null>(null)
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null)
  const [usageStatsError, setUsageStatsError] = useState("")
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const [filters, setFilters] = useState({
    type: "",
    hasRating: false,
    sort: "created_at",
    order: "desc"
  })
  const [pagination, setPagination] = useState({
    limit: 25,
    offset: 0
  })
  const [hasMore, setHasMore] = useState(false)

  const styles = {
    page: {
      minHeight: "100vh",
      backgroundColor: "#f8fafc",
      fontFamily: "sans-serif",
      color: "#111",
    },
    nav: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "20px 40px",
      backgroundColor: "#fff",
      borderBottom: "1px solid #e5e7eb",
      boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
    },
    logo: {
      fontWeight: 800,
      fontSize: "20px",
      letterSpacing: "-0.03em",
      display: "flex",
      alignItems: "center",
      gap: "8px",
    },
    logoIcon: {
      width: "28px",
      height: "28px",
      backgroundColor: "#111",
      borderRadius: "6px",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "16px",
      fontWeight: "bold",
    },
    container: {
      maxWidth: "1200px",
      margin: "0 auto",
      padding: "40px",
    },
    authContainer: {
      maxWidth: "400px",
      margin: "100px auto",
      backgroundColor: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: "12px",
      padding: "40px",
      boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
    },
    title: {
      fontSize: "24px",
      fontWeight: 700,
      marginBottom: "8px",
      textAlign: "center" as const,
    },
    subtitle: {
      fontSize: "14px",
      color: "#6b7280",
      marginBottom: "32px",
      textAlign: "center" as const,
    },
    input: {
      width: "100%",
      padding: "12px 16px",
      border: "1px solid #d1d5db",
      borderRadius: "8px",
      fontSize: "16px",
      fontFamily: "inherit",
      marginBottom: "16px",
    },
    button: {
      width: "100%",
      backgroundColor: "#111",
      color: "#fff",
      padding: "12px 24px",
      borderRadius: "8px",
      border: "none",
      fontSize: "16px",
      fontWeight: 500,
      cursor: "pointer",
      transition: "background-color 0.2s",
    },
    buttonDisabled: {
      backgroundColor: "#9ca3af",
      cursor: "not-allowed",
    },
    errorMessage: {
      backgroundColor: "#fee2e2",
      color: "#991b1b",
      padding: "12px",
      borderRadius: "8px",
      marginBottom: "16px",
      fontSize: "14px",
    },
    statsGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
      gap: "20px",
      marginBottom: "32px",
    },
    statCard: {
      backgroundColor: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: "12px",
      padding: "24px",
      boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
    },
    statTitle: {
      fontSize: "14px",
      fontWeight: 600,
      color: "#6b7280",
      marginBottom: "8px",
      textTransform: "uppercase" as const,
      letterSpacing: "0.05em",
    },
    statValue: {
      fontSize: "32px",
      fontWeight: 700,
      color: "#111",
    },
    filters: {
      backgroundColor: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: "12px",
      padding: "24px",
      marginBottom: "24px",
      display: "flex",
      flexWrap: "wrap" as const,
      gap: "16px",
      alignItems: "center",
    },
    select: {
      padding: "8px 12px",
      border: "1px solid #d1d5db",
      borderRadius: "6px",
      fontSize: "14px",
      fontFamily: "inherit",
      backgroundColor: "#fff",
    },
    checkbox: {
      marginRight: "8px",
    },
    feedbackList: {
      backgroundColor: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: "12px",
      overflow: "hidden",
    },
    feedbackItem: {
      borderBottom: "1px solid #f3f4f6",
      padding: "24px",
    },
    feedbackHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: "12px",
    },
    feedbackType: {
      backgroundColor: "#f3f4f6",
      color: "#374151",
      padding: "4px 8px",
      borderRadius: "4px",
      fontSize: "12px",
      fontWeight: 500,
    },
    feedbackRating: {
      display: "flex",
      alignItems: "center",
      gap: "4px",
    },
    star: {
      color: "#fbbf24",
      fontSize: "14px",
    },
    feedbackText: {
      fontSize: "16px",
      lineHeight: 1.6,
      color: "#374151",
      marginBottom: "12px",
    },
    feedbackMeta: {
      fontSize: "12px",
      color: "#9ca3af",
      display: "flex",
      flexWrap: "wrap" as const,
      gap: "16px",
    },
    loading: {
      textAlign: "center" as const,
      padding: "40px",
      color: "#6b7280",
    },
    loadMore: {
      textAlign: "center" as const,
      padding: "20px",
    },
    loadMoreButton: {
      backgroundColor: "#f3f4f6",
      color: "#374151",
      padding: "10px 20px",
      borderRadius: "6px",
      border: "1px solid #d1d5db",
      fontSize: "14px",
      cursor: "pointer",
    },
    backLink: {
      display: "inline-flex",
      alignItems: "center",
      color: "#6b7280",
      textDecoration: "none",
      fontSize: "14px",
      fontWeight: 500,
      marginBottom: "20px",
    },
  }

  // Check for existing authentication on mount
  useEffect(() => {
    const storedAuth = localStorage.getItem('admin_authenticated')
    const storedPassword = localStorage.getItem('admin_password')
    if (storedAuth === 'true' && storedPassword) {
      setPassword(storedPassword)
      setIsAuthenticated(true)
      loadFeedback()
      loadUsageStats(storedPassword)
    }
  }, [])

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsAuthenticating(true)
    setAuthError("")

    try {
      // Test authentication with a simple API call
      const response = await fetch(`/api/admin/feedback?password=${encodeURIComponent(password)}&limit=1`)

      if (response.ok) {
        setIsAuthenticated(true)
        localStorage.setItem('admin_authenticated', 'true')
        localStorage.setItem('admin_password', password) // Store password for API calls
        loadFeedback()
        loadUsageStats(password)
      } else {
        setAuthError("Invalid password")
      }
    } catch (error) {
      setAuthError("Authentication failed")
    } finally {
      setIsAuthenticating(false)
    }
  }

  const loadFeedback = async (append = false) => {
    setLoading(true)
    setError("")

    try {
      const params = new URLSearchParams({
        password: password,
        limit: pagination.limit.toString(),
        offset: pagination.offset.toString(),
        sort: filters.sort,
        order: filters.order,
      })

      if (filters.type) params.set('type', filters.type)
      if (filters.hasRating) params.set('has_rating', 'true')

      const response = await fetch(`/api/admin/feedback?${params}`)
      const data: FeedbackResponse = await response.json()

      if (response.ok) {
        setFeedback(append ? [...feedback, ...data.feedback] : data.feedback)
        setStats(data.stats)
        setTotal(data.total)
        setPagination(prev => ({ ...prev, ...data.pagination }))
        setHasMore(data.pagination.hasMore)
      } else {
        setError("Failed to load feedback")
      }
    } catch (error) {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  const loadUsageStats = async (authPassword?: string) => {
    const pwd = authPassword || password
    if (!pwd) return

    setUsageStatsError("")
    try {
      const response = await fetch(`/api/admin/usage?password=${encodeURIComponent(pwd)}`)
      const data = await response.json()

      if (response.ok) {
        setUsageStats(data)
      } else {
        const errorMsg = data.error || "Failed to load usage stats"
        setUsageStatsError(errorMsg)
        console.warn("Failed to load usage stats:", errorMsg)
      }
    } catch (error) {
      const errorMsg = "Network error loading usage stats"
      setUsageStatsError(errorMsg)
      console.warn(errorMsg, error)
    }
  }

  const handleFilterChange = (newFilters: Partial<typeof filters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }))
    setPagination(prev => ({ ...prev, offset: 0 }))
  }

  const loadMore = () => {
    setPagination(prev => ({ ...prev, offset: prev.offset + prev.limit }))
    loadFeedback(true)
  }

  const logout = () => {
    setIsAuthenticated(false)
    setPassword("")
    localStorage.removeItem('admin_authenticated')
    localStorage.removeItem('admin_password')
    setFeedback([])
    setStats(null)
    setUsageStats(null)
  }

  if (!isAuthenticated) {
    return (
      <div style={styles.page}>
        <nav style={styles.nav}>
          <Link href="/" style={styles.logo}>
            <div style={styles.logoIcon}>P</div>
          </Link>
        </nav>

        <div style={styles.container}>
          <div style={styles.authContainer}>
            <h1 style={styles.title}>Admin Access</h1>
            <p style={styles.subtitle}>Enter password to view feedback</p>

            <form onSubmit={handleAuth}>
              {authError && (
                <div style={styles.errorMessage}>
                  {authError}
                </div>
              )}

              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                style={styles.input}
                required
              />

              <button
                type="submit"
                disabled={isAuthenticating}
                style={{
                  ...styles.button,
                  ...(isAuthenticating ? styles.buttonDisabled : {})
                }}
              >
                {isAuthenticating ? "Authenticating..." : "Access Admin Panel"}
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <nav style={styles.nav}>
        <Link href="/" style={styles.logo}>
          <div style={styles.logoIcon}>P</div>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "14px", color: "#6b7280" }}>
            Admin Panel
          </span>
          <button
            onClick={logout}
            style={{
              fontSize: "14px",
              color: "#6b7280",
              background: "none",
              border: "none",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Logout
          </button>
        </div>
      </nav>

      <div style={styles.container}>
        <Link href="/" style={styles.backLink}>
          ← Back to Home
        </Link>

        <h1 style={{ fontSize: "32px", fontWeight: 800, marginBottom: "8px" }}>
          Feedback Admin
        </h1>
        <p style={{ fontSize: "16px", color: "#6b7280", marginBottom: "32px" }}>
          View and manage user feedback ({total} total)
        </p>

        {stats && (
          <div style={styles.statsGrid}>
            <div style={styles.statCard}>
              <div style={styles.statTitle}>Total Feedback</div>
              <div style={styles.statValue}>{total}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statTitle}>Average Rating</div>
              <div style={styles.statValue}>
                {stats.averageRating > 0 ? stats.averageRating.toFixed(1) : "N/A"}
              </div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statTitle}>With Ratings</div>
              <div style={styles.statValue}>
                {Object.values(stats.ratings).reduce((a, b) => a + b, 0)}
              </div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statTitle}>Categories</div>
              <div style={styles.statValue}>{Object.keys(stats.types).length}</div>
            </div>
          </div>
        )}

        {(usageStats || usageStatsError) && (
          <>
            <h2 style={{ fontSize: "24px", fontWeight: 800, marginBottom: "8px", marginTop: "32px" }}>
              Usage Statistics
            </h2>
            <p style={{ fontSize: "16px", color: "#6b7280", marginBottom: "24px" }}>
              AI reasoning feature usage metrics
            </p>

            {usageStatsError && (
              <div style={{
                ...styles.errorMessage,
                marginBottom: "24px",
                backgroundColor: "#fef3c7",
                color: "#92400e",
                border: "1px solid #f59e0b"
              }}>
                {usageStatsError}
              </div>
            )}

            {usageStats && (
              <div style={styles.statsGrid}>
                <div style={styles.statCard}>
                  <div style={styles.statTitle}>Unique Users</div>
                  <div style={styles.statValue}>{usageStats.totalUsers}</div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statTitle}>Total Usage</div>
                  <div style={styles.statValue}>{usageStats.totalUsage}</div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statTitle}>Generate Calls</div>
                  <div style={styles.statValue}>{usageStats.featureUsage.reasoning_generate || 0}</div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statTitle}>Retrieve Calls</div>
                  <div style={styles.statValue}>{usageStats.featureUsage.reasoning_retrieve || 0}</div>
                </div>
              </div>
            )}

            {usageStats && (
              <div style={{ marginTop: "32px" }}>
                <h3 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "16px" }}>
                  User Details
                </h3>
                <div style={styles.feedbackList}>
                  {usageStats.userDetails.map((user) => (
                    <div key={user.user_id} style={styles.feedbackItem}>
                      <div style={styles.feedbackHeader}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <span style={{ fontSize: "14px", fontWeight: 600 }}>
                            {user.user_email}
                          </span>
                          <span style={styles.feedbackType}>
                            {user.total_usage} total uses
                          </span>
                        </div>
                        <div style={{ fontSize: "12px", color: "#9ca3af" }}>
                          Last used: {new Date(user.last_used_at).toLocaleString()}
                        </div>
                      </div>

                      <div style={styles.feedbackMeta}>
                        {Object.entries(user.features_used).map(([feature, count]) => (
                          <span key={feature}>
                            {feature}: {count}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div style={styles.filters}>
          <select
            value={filters.type}
            onChange={(e) => handleFilterChange({ type: e.target.value })}
            style={styles.select}
          >
            <option value="">All Types</option>
            <option value="general">General</option>
            <option value="bug">Bug Report</option>
            <option value="feature">Feature Request</option>
            <option value="ui">UI Feedback</option>
            <option value="performance">Performance</option>
          </select>

          <label style={{ fontSize: "14px", display: "flex", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={filters.hasRating}
              onChange={(e) => handleFilterChange({ hasRating: e.target.checked })}
              style={styles.checkbox}
            />
            Has Rating Only
          </label>

          <select
            value={filters.sort}
            onChange={(e) => handleFilterChange({ sort: e.target.value })}
            style={styles.select}
          >
            <option value="created_at">Sort by Date</option>
            <option value="rating">Sort by Rating</option>
            <option value="feedback_type">Sort by Type</option>
          </select>

          <select
            value={filters.order}
            onChange={(e) => handleFilterChange({ order: e.target.value })}
            style={styles.select}
          >
            <option value="desc">Newest First</option>
            <option value="asc">Oldest First</option>
          </select>

          <button
            onClick={() => loadFeedback()}
            style={{
              ...styles.button,
              width: "auto",
              padding: "8px 16px",
              fontSize: "14px",
            }}
          >
            Apply Filters
          </button>
        </div>

        {error && (
          <div style={styles.errorMessage}>
            {error}
          </div>
        )}

        <div style={styles.feedbackList}>
          {loading && feedback.length === 0 && (
            <div style={styles.loading}>Loading feedback...</div>
          )}

          {feedback.map((item) => (
            <div key={item.id} style={styles.feedbackItem}>
              <div style={styles.feedbackHeader}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={styles.feedbackType}>{item.feedback_type}</span>
                  {item.rating && (
                    <div style={styles.feedbackRating}>
                      {Array.from({ length: 5 }, (_, i) => (
                        <span key={i} style={styles.star}>
                          {i < item.rating! ? "★" : "☆"}
                        </span>
                      ))}
                      <span style={{ fontSize: "12px", color: "#9ca3af", marginLeft: "4px" }}>
                        ({item.rating})
                      </span>
                    </div>
                  )}
                </div>
                <div style={{ fontSize: "12px", color: "#9ca3af" }}>
                  {new Date(item.created_at).toLocaleString()}
                </div>
              </div>

              <div style={styles.feedbackText}>
                {item.feedback_text}
              </div>

              <div style={styles.feedbackMeta}>
                {item.email && <span>Email: {item.email}</span>}
                <span>IP: {item.ip_address || "unknown"}</span>
                <span>User Agent: {item.user_agent ? item.user_agent.slice(0, 50) + "..." : "unknown"}</span>
              </div>
            </div>
          ))}

          {hasMore && (
            <div style={styles.loadMore}>
              <button
                onClick={loadMore}
                disabled={loading}
                style={{
                  ...styles.loadMoreButton,
                  ...(loading ? styles.buttonDisabled : {})
                }}
              >
                {loading ? "Loading..." : "Load More"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}