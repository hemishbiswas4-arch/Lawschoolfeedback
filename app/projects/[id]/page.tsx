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
  const [selectedFiles, setSelectedFiles] = useState<Array<{ file: File; id: string }>>([])
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null)

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

  /* ================= FILE SELECTION ================= */

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const pdfFiles = files.filter(f => f.type === "application/pdf")
    
    if (files.length !== pdfFiles.length) {
      alert("Only PDF files are supported. Non-PDF files were ignored.")
    }

    const newFiles = pdfFiles.map(file => ({
      file,
      id: `${Date.now()}-${Math.random()}`,
    }))

    setSelectedFiles(prev => [...prev, ...newFiles])
  }

  const removeSelectedFile = (fileId: string) => {
    setSelectedFiles(prev => prev.filter(f => f.id !== fileId))
  }

  /* ================= BATCH UPLOAD SOURCES (OPTIMIZED) ================= */

  const handleBatchUpload = async () => {
    if (selectedFiles.length === 0 || !sourceTitle.trim() || uploading) return

    setUploading(true)
    setUploadProgress({})

    const { data: session } = await supabase.auth.getSession()
    const user = session.session?.user

    if (!user) {
      router.replace("/login")
      setUploading(false)
      return
    }

    const filesToUpload = [...selectedFiles]
    const tempIds: string[] = []

    // Create optimistic sources for all files
    filesToUpload.forEach(({ file, id: fileId }) => {
      const tempId = `temp-${fileId}-${Date.now()}`
      tempIds.push(tempId)
      const fileTitle = filesToUpload.length === 1 
        ? sourceTitle.trim() 
        : `${sourceTitle.trim()} — ${file.name}`
      
      const optimisticSource: Source = {
        id: tempId,
        type: sourceType,
        title: fileTitle,
        created_at: new Date().toISOString(),
        optimistic: true,
      }

      setSources(prev => [optimisticSource, ...prev])
      setUploadProgress(prev => ({ ...prev, [fileId]: 5 }))
    })

    // Simulate progress for all files
    const progressIntervals = filesToUpload.map(({ id: fileId }) => {
      let progressValue = 5
      return setInterval(() => {
        progressValue = Math.min(progressValue + 2, 90)
        setUploadProgress(prev => ({ ...prev, [fileId]: progressValue }))
      }, 200)
    })

    try {
      // Batch upload all files in a single request
      const form = new FormData()
      filesToUpload.forEach(({ file }) => {
        form.append("file", file)
      })
      form.append("project_id", id)
      form.append("type", sourceType)
      form.append("title", sourceTitle.trim())
      form.append("user_id", user.id)

      console.log(`Starting batch upload for ${filesToUpload.length} file(s)...`)

      const res = await fetch("/api/sources/upload", {
        method: "POST",
        body: form,
      })

      // Clear progress intervals
      progressIntervals.forEach(interval => clearInterval(interval))

      if (!res.ok) {
        const errorText = await res.text().catch(() => "Upload failed")
        console.error(`Batch upload failed:`, res.status, errorText)
        
        // Remove all optimistic sources on failure
        setSources(prev => prev.filter(s => !tempIds.includes(s.id)))
        filesToUpload.forEach(({ id: fileId }) => {
          setUploadProgress(prev => {
            const newProgress = { ...prev }
            delete newProgress[fileId]
            return newProgress
          })
        })
        
        alert(`Upload failed: ${errorText}`)
        setUploading(false)
        return
      }

      const result = await res.json().catch(() => ({ ok: false, results: [] }))
      console.log(`Batch upload result:`, result)

      // Mark all files as complete
      filesToUpload.forEach(({ id: fileId }) => {
        setUploadProgress(prev => ({ ...prev, [fileId]: 100 }))
      })

      // Wait a moment for backend to process
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Remove optimistic sources
      setSources(prev => prev.filter(s => !tempIds.includes(s.id)))
      
      // Refresh sources to get real ones
      const { data: sourceData, error: refreshError } = await supabase
        .from("project_sources")
        .select("id, type, title, created_at")
        .eq("project_id", id)
        .order("created_at", { ascending: false })

      if (refreshError) {
        console.error("Error refreshing sources:", refreshError)
      } else if (sourceData) {
        setSources(sourceData)
        console.log(`Refreshed sources, now have ${sourceData.length} sources`)
      }

      // Check for failed files
      const failedFiles = result.results?.filter((r: any) => r.status === "failed") || []
      if (failedFiles.length > 0) {
        alert(`Upload complete. ${failedFiles.length} file(s) failed: ${failedFiles.map((f: any) => f.fileName).join(", ")}`)
      } else {
        console.log(`Successfully uploaded ${filesToUpload.length} file(s)`)
      }
    } catch (err: any) {
      // Clear progress intervals
      progressIntervals.forEach(interval => clearInterval(interval))
      
      console.error(`Batch upload error:`, err)
      
      // Remove all optimistic sources on error
      setSources(prev => prev.filter(s => !tempIds.includes(s.id)))
      filesToUpload.forEach(({ id: fileId }) => {
        setUploadProgress(prev => {
          const newProgress = { ...prev }
          delete newProgress[fileId]
          return newProgress
        })
      })
      
      alert(`Upload error: ${err.message || "Unknown error"}`)
    }

    setSourceTitle("")
    setSelectedFiles([])
    setUploadProgress({})
    setUploading(false)
  }

  /* ================= DELETE SOURCE ================= */

  const handleDeleteSource = async (sourceId: string, sourceTitle: string) => {
    if (!confirm(`Delete "${sourceTitle}"? This action cannot be undone.`)) return

    setDeletingSourceId(sourceId)

    try {
      const { error } = await supabase
        .from("project_sources")
        .delete()
        .eq("id", sourceId)

      if (error) throw error

      // Refresh sources
      const { data: sourceData } = await supabase
        .from("project_sources")
        .select("id, type, title, created_at")
        .eq("project_id", id)
        .order("created_at", { ascending: false })

      setSources(sourceData ?? [])
    } catch (err: any) {
      alert(err.message || "Failed to delete source")
    } finally {
      setDeletingSourceId(null)
    }
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
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px" }}>
            Add Sources (PDF)
          </h3>

          <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
            <select
              value={sourceType}
              onChange={e => setSourceType(e.target.value)}
              disabled={uploading}
              style={{
                padding: "8px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                fontSize: "13px",
                minWidth: "180px",
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
              placeholder="Source title (or base title for multiple files)"
              disabled={uploading}
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
            multiple
            disabled={uploading}
            onChange={handleFileSelect}
            style={{
              width: "100%",
              padding: "8px",
              borderRadius: "6px",
              border: "1px solid #d1d5db",
              fontSize: "13px",
              marginBottom: "12px",
            }}
          />

          {/* SELECTED FILES */}
          {selectedFiles.length > 0 && (
            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#374151", marginBottom: "8px" }}>
                Selected Files ({selectedFiles.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {selectedFiles.map(({ file, id }) => (
                  <div
                    key={id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 10px",
                      background: "#f9fafb",
                      borderRadius: "6px",
                      border: "1px solid #e5e7eb",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "12px", fontWeight: 500, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {file.name}
                      </div>
                      <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </div>
                    </div>
                    <button
                      onClick={() => removeSelectedFile(id)}
                      disabled={uploading}
                      style={{
                        marginLeft: "12px",
                        padding: "4px 8px",
                        background: "none",
                        border: "none",
                        color: "#dc2626",
                        cursor: uploading ? "not-allowed" : "pointer",
                        fontSize: "12px",
                        fontWeight: 500,
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* UPLOAD PROGRESS */}
          {uploading && selectedFiles.length > 0 && (
            <div style={{ marginBottom: "12px" }}>
              {selectedFiles.map(({ file, id }) => {
                const progress = uploadProgress[id] || 0
                return (
                  <div key={id} style={{ marginBottom: "8px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontSize: "11px", color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        {file.name}
                      </span>
                      <span style={{ fontSize: "11px", color: "#6b7280", marginLeft: "8px" }}>
                        {progress}%
                      </span>
                    </div>
                    <div
                      style={{
                        height: "6px",
                        background: "#e5e7eb",
                        borderRadius: "3px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${progress}%`,
                          height: "100%",
                          background: "#2563eb",
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <button
            onClick={handleBatchUpload}
            disabled={uploading || selectedFiles.length === 0 || !sourceTitle.trim()}
            style={{
              width: "100%",
              padding: "10px 16px",
              borderRadius: "8px",
              background: uploading || selectedFiles.length === 0 || !sourceTitle.trim() ? "#9ca3af" : "#111",
              color: "#fff",
              fontSize: "14px",
              fontWeight: 600,
              border: "none",
              cursor: uploading || selectedFiles.length === 0 || !sourceTitle.trim() ? "not-allowed" : "pointer",
              transition: "background 0.2s",
            }}
          >
            {uploading ? `Uploading ${selectedFiles.length} file(s)...` : `Upload ${selectedFiles.length || ""} file${selectedFiles.length !== 1 ? "s" : ""}`}
          </button>
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
                  style={{
                    padding: "12px",
                    borderBottom: "1px solid #f3f4f6",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    transition: "background 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    if (!s.optimistic) e.currentTarget.style.background = "#f9fafb"
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent"
                  }}
                >
                  <div
                    onClick={() =>
                      !s.optimistic && !deletingSourceId && router.push(`/projects/${id}/sources/${s.id}`)
                    }
                    style={{
                      flex: 1,
                      minWidth: 0,
                      cursor: s.optimistic || deletingSourceId ? "default" : "pointer",
                      opacity: s.optimistic ? 0.6 : 1,
                    }}
                  >
                    <div style={{ fontSize: "14px", fontWeight: 500, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.title}
                    </div>
                    <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
                      {s.type.toUpperCase()}
                      {s.optimistic && " (processing…)"}
                    </div>
                  </div>
                  {!s.optimistic && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteSource(s.id, s.title)
                      }}
                      disabled={deletingSourceId === s.id}
                      style={{
                        marginLeft: "12px",
                        padding: "6px 10px",
                        background: deletingSourceId === s.id ? "#f3f4f6" : "none",
                        border: "1px solid #e5e7eb",
                        borderRadius: "6px",
                        color: deletingSourceId === s.id ? "#9ca3af" : "#dc2626",
                        cursor: deletingSourceId === s.id ? "not-allowed" : "pointer",
                        fontSize: "12px",
                        fontWeight: 500,
                        transition: "all 0.2s",
                      }}
                      onMouseEnter={(e) => {
                        if (deletingSourceId !== s.id) {
                          e.currentTarget.style.background = "#fef2f2"
                          e.currentTarget.style.borderColor = "#dc2626"
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (deletingSourceId !== s.id) {
                          e.currentTarget.style.background = "none"
                          e.currentTarget.style.borderColor = "#e5e7eb"
                        }
                      }}
                    >
                      {deletingSourceId === s.id ? "Deleting..." : "Delete"}
                    </button>
                  )}
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
