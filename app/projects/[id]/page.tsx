"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useParams, useRouter } from "next/navigation"

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
  const [sourceType, setSourceType] = useState("case")
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

    /* 1️⃣ Optimistic insert */
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
      /* rollback optimistic insert */
      setSources(prev => prev.filter(s => s.id !== tempId))
      alert("Upload failed")
      return
    }

    /* 2️⃣ Reconcile with DB */
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
        {/* HEADER */}
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
              onChange={(e) => setSourceType(e.target.value)}
              style={{
                padding: "8px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                fontSize: "13px",
              }}
            >
              <optgroup label="Primary Law">
                <option value="case">Case</option>
                <option value="statute">Statute</option>
                <option value="regulation">Regulation</option>
                <option value="constitution">Constitution</option>
                <option value="treaty">Treaty</option>
              </optgroup>

              <optgroup label="Academic / Secondary">
                <option value="journal_article">Journal Article</option>
                <option value="book">Book</option>
                <option value="commentary">Commentary / Textbook</option>
                <option value="working_paper">Working Paper</option>
                <option value="thesis">Thesis / Dissertation</option>
              </optgroup>

              <optgroup label="Policy / Institutional">
                <option value="committee_report">Committee Report</option>
                <option value="law_commission_report">Law Commission Report</option>
                <option value="white_paper">White Paper</option>
                <option value="government_report">Government Report</option>
              </optgroup>

              <optgroup label="Digital / Informal">
                <option value="blog_post">Blog Post</option>
                <option value="news_article">News Article</option>
                <option value="website">Website</option>
                <option value="other">Other</option>
              </optgroup>
            </select>

            <input
              value={sourceTitle}
              onChange={(e) => setSourceTitle(e.target.value)}
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
            onChange={(e) => {
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
              {sources.map((s) => (
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
        </div>
      </div>
    </div>
  )
}
