// @/app/projects/new/page.tsx
"use client"
export const dynamic = "force-dynamic"

import { useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"

export default function NewProjectPage() {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createProject = async () => {
    if (!title.trim()) return

    setLoading(true)
    setError(null)

    const { data: session } = await supabase.auth.getSession()
    const user = session.session?.user

    if (!user) {
      router.replace("/login")
      return
    }

    const { data, error } = await supabase
      .from("projects")
      .insert({
        owner_id: user.id,
        title: title.trim(),
      })
      .select()
      .single()

    if (error || !data) {
      setError("Failed to create project")
      setLoading(false)
      return
    }

    router.push(`/projects/${data.id}`)
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "60px 20px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 700, marginBottom: "12px" }}>
          New Project
        </h1>

        <p style={{ fontSize: "14px", color: "#6b7280", marginBottom: "32px" }}>
          Create a project to begin building work from sources.
        </p>

        <label style={{ fontSize: "13px", fontWeight: 600 }}>
          Project Title
        </label>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Shareholder Rights in Hostile Takeovers"
          style={{
            width: "100%",
            padding: "12px",
            marginTop: "8px",
            marginBottom: "20px",
            borderRadius: "8px",
            border: "1px solid #d1d5db",
            fontSize: "14px",
          }}
        />

        {error && (
          <div style={{ color: "#b91c1c", fontSize: "13px", marginBottom: "12px" }}>
            {error}
          </div>
        )}

        <button
          onClick={createProject}
          disabled={loading || !title.trim()}
          style={{
            background: "#111",
            color: "#fff",
            padding: "12px 20px",
            borderRadius: "8px",
            border: "none",
            fontSize: "14px",
            fontWeight: 500,
            cursor: "pointer",
            opacity: loading || !title.trim() ? 0.6 : 1,
          }}
        >
          {loading ? "Creating…" : "Create Project"}
        </button>
      </div>
    </div>
  )
}
