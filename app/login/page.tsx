"use client"

import { useState } from "react"
import { supabase } from "@/lib/supabaseClient"

export default function Page() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

const signInWithGoogle = async () => {
  if (loading) return

  setLoading(true)
  setError(null)

  const next =
    new URLSearchParams(window.location.search).get("next") ?? "/dashboard"

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(
        next
      )}`,
    },
  })

  if (error) {
    console.error("Google sign-in error:", error)
    setError("Google sign-in failed. Please try again.")
    setLoading(false)
  }
}


  /* ================= STYLES ================= */

  const styles = {
    container: {
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column" as const,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#f9fafb",
      fontFamily: "sans-serif",
      color: "#111",
      padding: "20px",
    },
    card: {
      width: "100%",
      maxWidth: "380px",
      backgroundColor: "#ffffff",
      borderRadius: "12px",
      border: "1px solid #e5e7eb",
      boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)",
      padding: "40px 32px",
      textAlign: "center" as const,
    },
    logoPlaceholder: {
      width: "48px",
      height: "48px",
      backgroundColor: "#111",
      borderRadius: "10px",
      margin: "0 auto 24px auto",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "white",
      fontWeight: "bold",
      fontSize: "20px",
    },
    heading: {
      margin: "0 0 8px 0",
      fontSize: "24px",
      fontWeight: 700,
      letterSpacing: "-0.02em",
      color: "#111",
    },
    subHeading: {
      margin: "0 0 32px 0",
      fontSize: "14px",
      color: "#6b7280",
      lineHeight: 1.5,
    },
    button: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "12px",
      width: "100%",
      padding: "12px",
      backgroundColor: "#fff",
      border: "1px solid #d1d5db",
      borderRadius: "8px",
      fontSize: "14px",
      fontWeight: 500,
      color: "#374151",
      cursor: loading ? "not-allowed" : "pointer",
      transition: "background-color 0.2s, box-shadow 0.2s",
      opacity: loading ? 0.7 : 1,
    },
    errorBox: {
      marginTop: "20px",
      padding: "10px",
      backgroundColor: "#fef2f2",
      border: "1px solid #fecaca",
      borderRadius: "6px",
      color: "#991b1b",
      fontSize: "13px",
    },
    footer: {
      marginTop: "24px",
      fontSize: "12px",
      color: "#9ca3af",
    }
  }

  return (
    <div style={styles.container}>
      
      {/* CARD */}
      <div style={styles.card}>
        
        {/* LOGO ICON */}
        <div style={styles.logoPlaceholder}>
          P
        </div>

        <h1 style={styles.heading}>Welcome back</h1>
        <p style={styles.subHeading}>
          Sign in to your dashboard to collaborate on moots, research, and drafts.
        </p>

        <button
          onClick={signInWithGoogle}
          disabled={loading}
          style={styles.button}
          onMouseOver={(e) => {
            if (!loading) e.currentTarget.style.backgroundColor = "#f9fafb"
          }}
          onMouseOut={(e) => {
            if (!loading) e.currentTarget.style.backgroundColor = "#fff"
          }}
        >
          {loading ? (
             // Simple spinner
             <div style={{ width: "16px", height: "16px", border: "2px solid #e5e7eb", borderTop: "2px solid #374151", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
          ) : (
            // Google Icon
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.26.81-.58z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
          )}
          <span>{loading ? "Redirecting..." : "Continue with Google"}</span>
        </button>

        {error && (
          <div style={styles.errorBox}>
            {error}
          </div>
        )}
      </div>

      <div style={styles.footer}>
        &copy; {new Date().getFullYear()} Promethean Platform. Beta v0.1
      </div>

      {/* Inline animation style for the spinner */}
      <style jsx global>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}