// @/app/projects/[id]/page.tsx
"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useParams, useRouter } from "next/navigation"

/* ================= SOURCE CATEGORY CONFIG ================= */

/**
 * Edit THIS object to change categories or options.
 * No JSX changes required.
 */
const SOURCE_CATEGORIES: {
  label: string
  options: { value: string; label: string }[]
}[] = [
  {
    label: "Primary Law",
    options: [
      { value: "case", label: "Case" },
      { value: "statute", label: "Statute" },
      { value: "regulation", label: "Regulation" },
      { value: "constitution", label: "Constitution" },
      { value: "treaty", label: "Treaty" },
    ],
  },
  {
    label: "Academic / Secondary",
    options: [
      { value: "journal_article", label: "Journal Article" },
      { value: "book", label: "Book" },
      { value: "commentary", label: "Commentary / Textbook" },
      { value: "working_paper", label: "Working Paper" },
      { value: "thesis", label: "Thesis / Dissertation" },
    ],
  },
  {
    label: "Policy / Institutional",
    options: [
      { value: "committee_report", label: "Committee Report" },
      { value: "law_commission_report", label: "Law Commission Report" },
      { value: "white_paper", label: "White Paper" },
      { value: "government_report", label: "Government Report" },
    ],
  },
  {
    label: "Digital / Informal",
    options: [
      { value: "blog_post", label: "Blog Post" },
      { value: "news_article", label: "News Article" },
      { value: "website", label: "Website" },
      { value: "other", label: "Other" },
    ],
  },
]

/* ================= TYPES ================= */

type Project = {
  id: string
  title: string
  owner_id: string
}

type Source = {
  id: string
  type: string
  title: string
  created_at: string
  optimistic?: boolean
}

/* ================= PAGE ================= */

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [project, setProject] = useState<Project | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)

  /* New source state */
  const [sourceType, setSourceType] = useState(
    SOURCE_CATEGORIES[0].options[0].value
  )
  const [sourceTitle, setSourceTitle] = useState("")
  const [uploading, setUploading] = useState(false)

  /* ================= LOAD PROJECT + SOURCES ================= */

  useEffect(() => {
    const load = async () => {
      const { data: session } = await supabase.auth.getSession()
      const user = session.session?.user

      if (!user) {
        router.replace("/login")
        return
      }

      const { data: projectData, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .single()

      if (error || !projectData || projectData.owner_id !== user.id) {
        router.replace("/projects")
        return
      }

      const { data: sourceData } = await supabase
        .from("project_sources")
        .select("id, type, title, created_at")
        .eq("project_id", id)
        .order("created_at", { ascending: false })

      setProject(projectData)
      setSources(sourceData ?? [])
      setLoading(false)
    }

    load()
  }, [id, router])

  /* ================= UPLOAD SOURCE (PDF) ================= */

  const handleFileUpload = async (file: File) => {
    if (!file || !sourceTitle.trim()) return

    setUploading(true)

    const { data: session } = await supabase.auth.getSession()
    const user = session.session?.user

    if (!user) {
      router.replace("/login")
      return
    }

    /* Optimistic insert */
    const tempId = `temp-${Date.now()}`
    const optimisticSource: Source = {
      id: tempId,
      type: sourceType,
      title: sourceTitle.trim(),
      created_at: new Date().toISOString(),
      optimistic: true,
    }

    setSources(prev => [optimisticSource, ...prev])

    const form = new FormData()
    form.append("file", file)
    form.append("project_id", id)
    form.append("type", sourceType)
    form.append("title", sourceTitle.trim())
    form.append("user_id", user.id)

    const res = await fetch("/api/sources/upload", {
      method: "POST",
      body: form,
    })

    setSourceTitle("")
    setUploading(false)

    if (!res.ok) {
      setSources(prev => prev.filter(s => s.id !== tempId))
      alert("Upload failed")
      return
    }

    const { data: sourceData } = await supabase
      .from("project_sources")
      .select("id, type, title, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false })

    setSources(sourceData ?? [])
  }

  /* ================= RENDER ================= */

  if (loading) {
    return (
      <div style={{ padding: "80px", textAlign: "center", color: "#666" }}>
        Loading project…
      </div>
    )
  }

  if (!project) return null

  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "40px 20px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 700 }}>
          {project.title}
        </h1>

        <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "32px" }}>
          Project workspace
        </p>

        {/* ADD SOURCE */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            padding: "20px",
            marginBottom: "24px",
          }}
        >
          <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "12px" }}>
            Add source (PDF)
          </h3>

          <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
            <select
              value={sourceType}
              onChange={e => setSourceType(e.target.value)}
              style={{
                padding: "8px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                fontSize: "13px",
              }}
            >
              {SOURCE_CATEGORIES.map(cat => (
                <optgroup key={cat.label} label={cat.label}>
                  {cat.options.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            <input
              value={sourceTitle}
              onChange={e => setSourceTitle(e.target.value)}
              placeholder="Source title"
              style={{
                flex: 1,
                padding: "8px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                fontSize: "13px",
              }}
            />
          </div>

          <input
            type="file"
            accept="application/pdf"
            disabled={uploading || !sourceTitle.trim()}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleFileUpload(file)
            }}
          />
        </div>

        {/* SOURCE LIST */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            padding: "20px",
          }}
        >
          <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "12px" }}>
            Sources
          </h3>

          {sources.length === 0 ? (
            <p style={{ fontSize: "14px", color: "#6b7280" }}>
              No sources added yet.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {sources.map(s => (
                <li
                  key={s.id}
                  onClick={() =>
                    !s.optimistic && router.push(`/projects/${id}/sources/${s.id}`)
                  }
                  style={{
                    padding: "10px 0",
                    borderBottom: "1px solid #f3f4f6",
                    cursor: s.optimistic ? "default" : "pointer",
                    opacity: s.optimistic ? 0.6 : 1,
                  }}
                >
                  <div style={{ fontSize: "14px", fontWeight: 500 }}>
                    {s.title}
                  </div>
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>
                    {s.type.toUpperCase()}
                    {s.optimistic && " (processing…)"}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <button
            onClick={() => router.push(`/projects/${id}/query`)}
            style={{
              marginTop: "24px",
              padding: "10px 16px",
              borderRadius: "8px",
              background: "#111",
              color: "#fff",
              fontSize: "14px",
              fontWeight: 500,
            }}
          >
            Continue to Research
          </button>
        </div>
      </div>
    </div>
  )
}
