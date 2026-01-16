// @/app/projects/[id]/page.tsx
"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"

import { SUPPORTED_SOURCE_TYPES, SOURCE_TYPE_LABELS, SOURCE_TYPE_DESCRIPTIONS, SourceType } from "@/lib/sourceTypes"

/* ================= SOURCE CATEGORY CONFIG ================= */

/**
 * Edit THIS object to change categories or options.
 * No JSX changes required.
 */
const SOURCE_CATEGORIES: {
  label: string
  description: string
  recommendation: string
  options: { value: string; label: string; description?: string }[]
}[] = [
  {
    label: "Primary Law",
    description: "Official legal sources that establish or interpret the law",
    recommendation: "Best for comprehensive legal research - include these first",
    options: [
      { value: "case", label: SOURCE_TYPE_LABELS.case, description: SOURCE_TYPE_DESCRIPTIONS.case },
      { value: "statute", label: SOURCE_TYPE_LABELS.statute, description: SOURCE_TYPE_DESCRIPTIONS.statute },
      { value: "regulation", label: SOURCE_TYPE_LABELS.regulation, description: SOURCE_TYPE_DESCRIPTIONS.regulation },
      { value: "constitution", label: SOURCE_TYPE_LABELS.constitution, description: SOURCE_TYPE_DESCRIPTIONS.constitution },
      { value: "treaty", label: SOURCE_TYPE_LABELS.treaty, description: SOURCE_TYPE_DESCRIPTIONS.treaty },
    ],
  },
  {
    label: "Academic / Secondary",
    description: "Scholarly analysis and interpretation of legal principles",
    recommendation: "Essential for understanding context and scholarly debate",
    options: [
      { value: "journal_article", label: SOURCE_TYPE_LABELS.journal_article, description: SOURCE_TYPE_DESCRIPTIONS.journal_article },
      { value: "book", label: SOURCE_TYPE_LABELS.book, description: SOURCE_TYPE_DESCRIPTIONS.book },
      { value: "commentary", label: SOURCE_TYPE_LABELS.commentary, description: SOURCE_TYPE_DESCRIPTIONS.commentary },
    ],
  },
  {
    label: "Other",
    description: "Additional document types",
    recommendation: "For sources that don't fit other categories",
    options: [
      { value: "other", label: SOURCE_TYPE_LABELS.other, description: SOURCE_TYPE_DESCRIPTIONS.other },
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
  const [sourceType, setSourceType] = useState<SourceType>(
    SUPPORTED_SOURCE_TYPES[0]
  )
  const [sourceTitle, setSourceTitle] = useState("")
  const [uploading, setUploading] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<Array<{ file: File; id: string }>>([])
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [uploadErrors, setUploadErrors] = useState<Record<string, { message: string; suggestions?: string[] }>>({})
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [showSourceGuidance, setShowSourceGuidance] = useState(false)
  const [titleError, setTitleError] = useState<string>("")

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

    // Validate file sizes (200MB limit per file - increased for larger files)
    const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB
    const validFiles = []
    const oversizedFiles = []
    const invalidFiles = []

    for (const file of pdfFiles) {
      if (file.size > MAX_FILE_SIZE) {
        oversizedFiles.push(file.name)
      } else if (file.size < 100) {
        // Basic check for empty or corrupted files
        invalidFiles.push(file.name)
      } else {
        validFiles.push(file)
      }
    }

    if (invalidFiles.length > 0) {
      alert(`The following files appear to be empty or corrupted and were skipped:\n${invalidFiles.join('\n')}`)
    }

    if (oversizedFiles.length > 0) {
      alert(`The following files exceed the 200MB limit and were skipped:\n${oversizedFiles.join('\n')}`)
    }

    // Check total file count limit (50 files max)
    const currentCount = selectedFiles.length
    const newValidCount = validFiles.length
    const maxTotalFiles = 50

    if (currentCount + newValidCount > maxTotalFiles) {
      const allowedCount = maxTotalFiles - currentCount
      validFiles.splice(allowedCount)
      alert(`Maximum ${maxTotalFiles} files allowed. Only the first ${allowedCount} valid files were added.`)
    }

    const newFiles = validFiles.map(file => ({
      file,
      id: `${Date.now()}-${Math.random()}`,
    }))

    setSelectedFiles(prev => [...prev, ...newFiles])
  }

  const removeSelectedFile = (fileId: string) => {
    setSelectedFiles(prev => prev.filter(f => f.id !== fileId))
  }

  /* ================= DRAG AND DROP ================= */

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!uploading) setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    if (uploading) return

    const files = Array.from(e.dataTransfer.files || [])
    const pdfFiles = files.filter(f => f.type === "application/pdf")

    if (files.length !== pdfFiles.length) {
      alert("Only PDF files are supported. Non-PDF files were ignored.")
    }

    // Validate file sizes (200MB limit per file - increased for larger files)
    const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB
    const validFiles = []
    const oversizedFiles = []
    const invalidFiles = []

    for (const file of pdfFiles) {
      if (file.size > MAX_FILE_SIZE) {
        oversizedFiles.push(file.name)
      } else if (file.size < 100) {
        // Basic check for empty or corrupted files
        invalidFiles.push(file.name)
      } else {
        validFiles.push(file)
      }
    }

    if (invalidFiles.length > 0) {
      alert(`The following files appear to be empty or corrupted and were skipped:\n${invalidFiles.join('\n')}`)
    }

    if (oversizedFiles.length > 0) {
      alert(`The following files exceed the 200MB limit and were skipped:\n${oversizedFiles.join('\n')}`)
    }

    // Check total file count limit (50 files max)
    const currentCount = selectedFiles.length
    const newValidCount = validFiles.length
    const maxTotalFiles = 50

    if (currentCount + newValidCount > maxTotalFiles) {
      const allowedCount = maxTotalFiles - currentCount
      validFiles.splice(allowedCount)
      alert(`Maximum ${maxTotalFiles} files allowed. Only the first ${allowedCount} valid files were added.`)
    }

    const newFiles = validFiles.map(file => ({
      file,
      id: `${Date.now()}-${Math.random()}`,
    }))

    setSelectedFiles(prev => [...prev, ...newFiles])
  }

  /* ================= INDIVIDUAL FILE UPLOAD ================= */

  const uploadSingleFile = async (fileData: { file: File; id: string }, user: any, baseTitle: string) => {
    const { file, id: fileId } = fileData

    // Create optimistic source
    const tempId = `temp-${fileId}-${Date.now()}`
    const fileTitle = selectedFiles.length === 1
      ? baseTitle.trim()
      : `${baseTitle.trim()} — ${file.name}`

    const optimisticSource: Source = {
      id: tempId,
      type: sourceType,
      title: fileTitle,
      created_at: new Date().toISOString(),
      optimistic: true,
    }

    setSources(prev => [optimisticSource, ...prev])
    setUploadProgress(prev => ({ ...prev, [fileId]: 5 }))

    // Simulate progress (faster updates for better UX)
    let progressValue = 5
    const progressInterval = setInterval(() => {
      progressValue = Math.min(progressValue + 3, 85) // Faster progress, leave more room for actual completion
      setUploadProgress(prev => ({ ...prev, [fileId]: progressValue }))
    }, 400)

    try {
      // Upload single file
      const form = new FormData()
      form.append("file", file)
      form.append("project_id", id)
      form.append("type", sourceType)
      form.append("title", fileTitle)
      form.append("user_id", user.id)

      console.log(`Uploading file: ${file.name}...`)

      const res = await fetch("/api/sources/upload", {
        method: "POST",
        body: form,
      })

      clearInterval(progressInterval)

      if (!res.ok) {
        let errorData: any = {}
        try {
          errorData = await res.json()
        } catch {
          const errorText = await res.text().catch(() => "Upload failed")
          errorData = { error: errorText }
        }

        console.error(`Upload failed for ${file.name}:`, res.status, errorData)

        // Remove optimistic source
        setSources(prev => prev.filter(s => s.id !== tempId))

        // Set error
        setUploadErrors(prev => ({
          ...prev,
          [fileId]: {
            message: errorData.error || "Upload failed",
            suggestions: errorData.suggestions
          }
        }))

        return { success: false, fileId, error: errorData }
      } else {
        const data = await res.json()
        console.log(`Upload successful for ${file.name}:`, data)

        // Remove optimistic source and add real one
        setSources(prev => prev.filter(s => s.id !== tempId))

        const result = data.results[0]
        if (result.status === "ok" && result.sourceId) {
          const uploadedSource: Source = {
            id: result.sourceId,
            type: sourceType,
            title: result.fileName,
            created_at: new Date().toISOString(),
          }
          setSources(prev => [uploadedSource, ...prev])
        }

        // Set progress to 100% on success
        setUploadProgress(prev => ({ ...prev, [fileId]: 100 }))

        return { success: true, fileId }
      }
    } catch (err: any) {
      console.error(`Upload error for ${file.name}:`, err)

      clearInterval(progressInterval)

      // Remove optimistic source
      setSources(prev => prev.filter(s => s.id !== tempId))

      // Set error
      setUploadErrors(prev => ({
        ...prev,
        [fileId]: {
          message: err.message || "Network error",
          suggestions: ["Try uploading again", "Check your internet connection"]
        }
      }))

      return { success: false, fileId, error: err }
    }
  }

  /* ================= UPLOAD ALL FILES INDIVIDUALLY ================= */

  const handleBatchUpload = async () => {
    // Clear previous errors
    setUploadErrors({})
    setTitleError("")

    // Validate title
    if (!sourceTitle.trim()) {
      setTitleError("Title is required. Please enter a title for your source(s).")
      return
    }

    if (selectedFiles.length === 0 || uploading) return

    setUploading(true)
    setUploadProgress({})
    setUploadErrors({})

    const { data: session } = await supabase.auth.getSession()
    const user = session.session?.user

    if (!user) {
      router.replace("/login")
      setUploading(false)
      return
    }

    const filesToUpload = [...selectedFiles]
    const results = []

    try {
      // Upload files in parallel with concurrency control to avoid overwhelming the server
      const CONCURRENCY_LIMIT = 5 // Increased for better throughput
      const fileBatches: typeof filesToUpload[] = []
      for (let i = 0; i < filesToUpload.length; i += CONCURRENCY_LIMIT) {
        fileBatches.push(filesToUpload.slice(i, i + CONCURRENCY_LIMIT))
      }

      for (const batch of fileBatches) {
        const batchResults = await Promise.all(
          batch.map(fileData => uploadSingleFile(fileData, user, sourceTitle.trim()))
        )
        results.push(...batchResults)
      }

      const successfulUploads = results.filter(r => r.success)
      const failedUploads = results.filter(r => !r.success)

      console.log(`Upload complete: ${successfulUploads.length} successful, ${failedUploads.length} failed`)

      // Clear uploaded files if all succeeded
      if (failedUploads.length === 0) {
        setSelectedFiles([])
        setSourceTitle("")
      }

      // Show summary if there were failures
      if (failedUploads.length > 0) {
        alert(`Upload complete: ${successfulUploads.length} files uploaded successfully, ${failedUploads.length} failed. Check individual file status below.`)
      }

    } catch (err: any) {
      console.error("Upload process error:", err)
      alert(`Upload process failed: ${err.message || "Unknown error"}`)
    } finally {
      setUploading(false)
    }
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
    <div style={{
      minHeight: "100vh",
      background: "#f9fafb",
      fontFamily: "system-ui, -apple-system, sans-serif",
      padding: "40px 50px"
    }}>
      <div style={{
        maxWidth: "1100px",
        margin: "0 auto"
      }}>
        {/* Workflow Header */}
        <div style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: "16px",
          padding: "32px",
          marginBottom: "32px",
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)"
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "24px"
          }}>
            <Link
              href="/projects"
              style={{
                padding: "8px 16px",
                borderRadius: "6px",
                background: "#ffffff",
                color: "#374151",
                fontSize: "14px",
                fontWeight: 500,
                textDecoration: "none",
                border: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                transition: "all 0.2s"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#f9fafb"
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#ffffff"
              }}
            >
              ← Back to Projects
            </Link>

            <div style={{
              padding: "6px 12px",
              background: sources.length > 0 ? "#ecfdf5" : "#fef3c7",
              border: `1px solid ${sources.length > 0 ? "#d1fae5" : "#fde68a"}`,
              borderRadius: "50px",
              fontSize: "12px",
              fontWeight: 600,
              color: sources.length > 0 ? "#065f46" : "#92400e",
              whiteSpace: "nowrap"
            }}>
              {sources.length === 0 ? "No sources uploaded" : `${sources.length} source${sources.length !== 1 ? 's' : ''} uploaded`}
            </div>
          </div>

          <h1 style={{
            fontSize: "28px",
            fontWeight: 700,
            color: "#111",
            margin: "0 0 8px 0"
          }}>
            {project.title}
          </h1>

          {/* Workflow Steps */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "32px",
            marginBottom: "24px",
            flexWrap: "wrap"
          }}>
            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "8px",
              opacity: sources.length === 0 ? 1 : 0.6
            }}>
              <div style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                background: sources.length === 0 ? "#2563eb" : "#10b981",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "18px",
                fontWeight: 600
              }}>
                1
              </div>
              <div style={{
                fontSize: "12px",
                fontWeight: 600,
                color: sources.length === 0 ? "#2563eb" : "#10b981",
                textAlign: "center"
              }}>
                Upload Sources
              </div>
            </div>

            <div style={{
              width: "60px",
              height: "2px",
              background: sources.length > 0 ? "#10b981" : "#e5e7eb",
              flexShrink: 0
            }}></div>

            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "8px",
              opacity: sources.length > 0 && sources.filter(s => !s.optimistic).length === 0 ? 1 : sources.length > 0 ? 0.6 : 0.3
            }}>
              <div style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                background: sources.length > 0 && sources.filter(s => !s.optimistic).length === 0 ? "#f59e0b" : sources.length > 0 ? "#10b981" : "#e5e7eb",
                color: sources.length > 0 ? "#fff" : "#9ca3af",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "18px",
                fontWeight: 600
              }}>
                2
              </div>
              <div style={{
                fontSize: "12px",
                fontWeight: 600,
                color: sources.length > 0 && sources.filter(s => !s.optimistic).length === 0 ? "#f59e0b" : sources.length > 0 ? "#10b981" : "#9ca3af",
                textAlign: "center"
              }}>
                Processing
              </div>
            </div>

            <div style={{
              width: "60px",
              height: "2px",
              background: sources.filter(s => !s.optimistic).length > 0 ? "#10b981" : "#e5e7eb",
              flexShrink: 0
            }}></div>

            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "8px",
              opacity: sources.filter(s => !s.optimistic).length > 0 ? 1 : 0.3
            }}>
              <div style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                background: sources.filter(s => !s.optimistic).length > 0 ? "#10b981" : "#e5e7eb",
                color: sources.filter(s => !s.optimistic).length > 0 ? "#fff" : "#9ca3af",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "18px",
                fontWeight: 600,
                cursor: sources.filter(s => !s.optimistic).length > 0 ? "pointer" : "default"
              }}
              onClick={() => sources.filter(s => !s.optimistic).length > 0 && router.push(`/projects/${id}/query`)}
              >
                3
              </div>
              <div style={{
                fontSize: "12px",
                fontWeight: 600,
                color: sources.filter(s => !s.optimistic).length > 0 ? "#10b981" : "#9ca3af",
                textAlign: "center",
                cursor: sources.filter(s => !s.optimistic).length > 0 ? "pointer" : "default"
              }}
              onClick={() => sources.filter(s => !s.optimistic).length > 0 && router.push(`/projects/${id}/query`)}
              >
                Start Research
              </div>
            </div>
          </div>

          {/* Status Message */}
          {sources.length === 0 && (
            <div style={{
              textAlign: "center",
              padding: "20px",
              background: "#f8fafc",
              borderRadius: "8px",
              border: "1px solid #e2e8f0"
            }}>
              <div style={{ fontSize: "16px", fontWeight: 600, color: "#374151", marginBottom: "8px" }}>
                🚀 Ready to start your research?
              </div>
              <div style={{ fontSize: "14px", color: "#6b7280", lineHeight: 1.5 }}>
                Upload legal documents, case law, or academic sources below to build your research foundation.
              </div>
            </div>
          )}

          {sources.length > 0 && sources.filter(s => !s.optimistic).length === 0 && (
            <div style={{
              textAlign: "center",
              padding: "20px",
              background: "#fefce8",
              borderRadius: "8px",
              border: "1px solid #fde68a"
            }}>
              <div style={{ fontSize: "16px", fontWeight: 600, color: "#92400e", marginBottom: "8px" }}>
                🔄 Processing your sources...
              </div>
              <div style={{ fontSize: "14px", color: "#a16207", lineHeight: 1.5 }}>
                We're analyzing your uploaded documents. This may take a few minutes for large files.
              </div>
            </div>
          )}

          {sources.filter(s => !s.optimistic).length > 0 && (
            <div style={{
              textAlign: "center",
              padding: "20px",
              background: "#f0fdf4",
              borderRadius: "8px",
              border: "1px solid #bbf7d0"
            }}>
              <div style={{ fontSize: "16px", fontWeight: 600, color: "#166534", marginBottom: "8px" }}>
                ✅ Ready to research!
              </div>
              <div style={{ fontSize: "14px", color: "#14532d", lineHeight: 1.5, marginBottom: "16px" }}>
                Your sources are processed and ready. Click "Start Research" above or continue uploading more sources.
              </div>
              <button
                onClick={() => router.push(`/projects/${id}/query`)}
                style={{
                  padding: "12px 24px",
                  background: "#10b981",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "0 2px 4px rgba(16, 185, 129, 0.2)"
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#059669"}
                onMouseLeave={(e) => e.currentTarget.style.background = "#10b981"}
              >
                Start Research Now →
              </button>
            </div>
          )}
        </div>

        {/* Quick Tips */}
        {sources.length === 0 && (
          <div style={{
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            padding: "20px",
            marginBottom: "24px"
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "16px" }}>
              <div style={{ fontSize: "24px" }}>💡</div>
              <div>
                <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px", color: "#111" }}>
                  Quick Start Tips
                </h3>
                <div style={{ display: "grid", gap: "8px", fontSize: "14px", color: "#374151" }}>
                  <div>• Start with court decisions, statutes, or legal briefs</div>
                  <div>• Upload 3-5 key documents to begin your research</div>
                  <div>• You can always add more sources later</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* UPLOAD SECTION */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "16px",
            padding: "32px",
            marginBottom: "32px",
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
          }}
        >
          <div style={{ marginBottom: "24px" }}>
            <h3 style={{ fontSize: "20px", fontWeight: 600, color: "#111", margin: "0 0 8px 0" }}>
              📄 Upload Documents
            </h3>
            <p style={{ fontSize: "14px", color: "#6b7280", margin: 0, lineHeight: 1.5 }}>
              Add legal documents, court cases, articles, or other sources to build your research foundation.
            </p>
          </div>

          {/* Source Type Selection */}
          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", fontSize: "14px", fontWeight: 600, color: "#374151", marginBottom: "8px" }}>
              What type of document is this?
            </label>
            <select
              value={sourceType}
              onChange={e => setSourceType(e.target.value as SourceType)}
              disabled={uploading}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid #d1d5db",
                fontSize: "14px",
                background: "#fff",
                marginBottom: "8px",
              }}
            >
              {SUPPORTED_SOURCE_TYPES.map(type => (
                <option key={type} value={type}>
                  {SOURCE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>
              Choose the most appropriate category for your document
            </div>
          </div>


          {/* Source Title */}
          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", fontSize: "14px", fontWeight: 600, color: "#374151", marginBottom: "8px" }}>
              Document Title <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              value={sourceTitle}
              onChange={e => {
                setSourceTitle(e.target.value)
                if (titleError && e.target.value.trim()) {
                  setTitleError("")
                }
              }}
              placeholder={selectedFiles.length > 1 ? "e.g., 'Recent Supreme Court Cases'" : "e.g., 'Smith v. Jones (2023)'"}
              disabled={uploading}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "8px",
                border: titleError ? "2px solid #ef4444" : "1px solid #d1d5db",
                fontSize: "14px",
                background: "#fff",
                transition: "border-color 0.2s",
              }}
            />
            {titleError && (
              <div style={{
                marginTop: "8px",
                padding: "8px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: "6px",
                fontSize: "13px",
                color: "#991b1b"
              }}>
                ⚠️ Please enter a title for your document
              </div>
            )}
          </div>

          {/* DRAG AND DROP UPLOAD AREA */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${isDragOver ? '#2563eb' : '#cbd5e1'}`,
              borderRadius: "12px",
              padding: "40px 24px",
              textAlign: "center",
              background: isDragOver ? "#eff6ff" : "#fafbfc",
              transition: "all 0.2s ease",
              cursor: uploading ? "not-allowed" : "pointer",
              marginBottom: "16px",
              position: "relative"
            }}
          >
            <input
              type="file"
              accept="application/pdf"
              multiple
              disabled={uploading}
              onChange={handleFileSelect}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                opacity: 0,
                cursor: uploading ? "not-allowed" : "pointer",
              }}
            />

            <div style={{ fontSize: "16px", fontWeight: 600, color: "#374151", marginBottom: "8px", textAlign: "center" }}>
              {isDragOver ? "Drop PDF files here" : "Drag & drop PDF files here"}
            </div>

            <div style={{ fontSize: "14px", color: "#6b7280", marginBottom: "16px", textAlign: "center" }}>
              or click to browse files
            </div>

            <div style={{
              display: "flex",
              justifyContent: "center",
              gap: "20px",
              fontSize: "12px",
              color: "#6b7280",
              flexWrap: "wrap",
              textAlign: "center"
            }}>
              <span>📄 PDF files only</span>
              <span>📏 Up to 200MB each</span>
              <span>📚 Up to 50 files</span>
              <span>⏱️ Large files may take time to process</span>
            </div>
          </div>

          {/* SELECTED FILES */}
          {selectedFiles.length > 0 && (
            <div style={{ marginBottom: "24px" }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "16px"
              }}>
                <h4 style={{ fontSize: "16px", fontWeight: 600, color: "#374151", margin: 0 }}>
                  Selected Files ({selectedFiles.length})
                </h4>
                <button
                  onClick={() => setSelectedFiles([])}
                  disabled={uploading}
                  style={{
                    padding: "6px 12px",
                    background: "none",
                    border: "1px solid #ef4444",
                    borderRadius: "6px",
                    color: "#ef4444",
                    fontSize: "12px",
                    cursor: uploading ? "not-allowed" : "pointer",
                    opacity: uploading ? 0.5 : 1,
                    transition: "all 0.2s"
                  }}
                  onMouseEnter={(e) => !uploading && (e.currentTarget.style.background = "#fef2f2")}
                  onMouseLeave={(e) => !uploading && (e.currentTarget.style.background = "none")}
                >
                  Clear All
                </button>
              </div>

              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr",
                gap: "12px"
              }}>
                {selectedFiles.map(({ file, id }) => {
                  const fileError = uploadErrors[id]
                  return (
                    <div
                      key={id}
                      style={{
                        padding: "12px",
                        background: fileError ? "#fef2f2" : "#f8fafc",
                        borderRadius: "8px",
                        border: fileError ? "2px solid #ef4444" : "1px solid #e2e8f0",
                        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ flex: 1, minWidth: 0, marginRight: "12px" }}>
                          <div style={{
                            fontSize: "13px",
                            fontWeight: 500,
                            color: "#1e293b",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            marginBottom: "4px"
                          }}>
                            {file.name}
                          </div>
                          <div style={{ fontSize: "11px", color: "#64748b" }}>
                            {(file.size / 1024 / 1024).toFixed(2)} MB
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            removeSelectedFile(id)
                            setUploadErrors(prev => {
                              const newErrors = { ...prev }
                              delete newErrors[id]
                              return newErrors
                            })
                          }}
                          disabled={uploading}
                          style={{
                            padding: "6px",
                            background: "none",
                            border: "none",
                            color: "#ef4444",
                            cursor: uploading ? "not-allowed" : "pointer",
                            fontSize: "16px",
                            borderRadius: "4px",
                            transition: "all 0.2s",
                            opacity: uploading ? 0.5 : 1
                          }}
                          onMouseEnter={(e) => !uploading && (e.currentTarget.style.background = "#fef2f2")}
                          onMouseLeave={(e) => !uploading && (e.currentTarget.style.background = "none")}
                          title="Remove file"
                        >
                          ×
                        </button>
                      </div>
                      {fileError && (
                        <div style={{
                          marginTop: "8px",
                          padding: "8px",
                          background: "#fff",
                          borderRadius: "4px",
                          fontSize: "12px",
                          color: "#991b1b"
                        }}>
                          <div style={{ fontWeight: 600, marginBottom: "4px" }}>
                            ⚠️ {fileError.message}
                          </div>
                          {fileError.suggestions && fileError.suggestions.length > 0 && (
                            <div style={{ fontSize: "11px", color: "#7f1d1d", marginTop: "4px" }}>
                              <strong>Suggestions:</strong>
                              <ul style={{ margin: "4px 0 0 0", paddingLeft: "20px" }}>
                                {fileError.suggestions.map((suggestion, idx) => (
                                  <li key={idx}>{suggestion}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* UPLOAD PROGRESS */}
          {uploading && selectedFiles.length > 0 && (
            <div style={{ marginBottom: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                <h4 style={{ fontSize: "16px", fontWeight: 600, color: "#374151", margin: 0 }}>
                  Upload Progress
                </h4>
                <div style={{ fontSize: "14px", color: "#6b7280" }}>
                  {(() => {
                    const completedFiles = selectedFiles.filter(({ id }) => uploadProgress[id] === 100).length
                    const failedFiles = Object.keys(uploadErrors).length
                    return `${completedFiles}/${selectedFiles.length} files processed${failedFiles > 0 ? ` • ${failedFiles} failed` : ''}`
                  })()}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {selectedFiles.map(({ file, id }) => {
                  const progress = uploadProgress[id] || 0
                  return (
                    <div key={id} style={{
                      padding: "16px",
                      background: "#f8fafc",
                      borderRadius: "8px",
                      border: "1px solid #e2e8f0"
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                        <span style={{
                          fontSize: "13px",
                          color: "#1e293b",
                          fontWeight: 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: 1
                        }}>
                          {file.name}
                        </span>
                        <span style={{ fontSize: "13px", color: "#2563eb", fontWeight: 600, marginLeft: "12px" }}>
                          {progress}%
                        </span>
                      </div>
                      <div
                        style={{
                          height: "8px",
                          background: "#e2e8f0",
                          borderRadius: "4px",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${progress}%`,
                            height: "100%",
                            background: progress === 100 ? "#10b981" : "#2563eb",
                            transition: "width 0.3s ease",
                            borderRadius: "4px"
                          }}
                        />
                      </div>
                      {progress === 100 && !uploadErrors[id] && (
                        <div style={{
                          fontSize: "11px",
                          color: "#10b981",
                          marginTop: "4px",
                          fontWeight: 500
                        }}>
                          ✓ Complete
                        </div>
                      )}
                      {uploadErrors[id] && (
                        <div style={{
                          marginTop: "8px",
                          padding: "8px",
                          background: "#fef2f2",
                          borderRadius: "4px",
                          fontSize: "11px",
                          color: "#991b1b"
                        }}>
                          <div style={{ fontWeight: 600, marginBottom: "4px" }}>
                            ⚠️ {uploadErrors[id].message}
                          </div>
                          {uploadErrors[id].suggestions && uploadErrors[id].suggestions!.length > 0 && (
                            <div style={{ fontSize: "10px", color: "#7f1d1d", marginTop: "4px" }}>
                              <strong>Suggestions:</strong>
                              <ul style={{ margin: "4px 0 0 0", paddingLeft: "16px" }}>
                                {uploadErrors[id].suggestions!.map((suggestion, idx) => (
                                  <li key={idx}>{suggestion}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* UPLOAD BUTTON */}
          <button
            onClick={handleBatchUpload}
            disabled={uploading || selectedFiles.length === 0 || !sourceTitle.trim()}
            style={{
              width: "100%",
              padding: "16px",
              borderRadius: "12px",
              background: uploading || selectedFiles.length === 0 || !sourceTitle.trim() ? "#9ca3af" : "#111",
              color: "#fff",
              fontSize: "16px",
              fontWeight: 600,
              border: "none",
              cursor: uploading || selectedFiles.length === 0 || !sourceTitle.trim() ? "not-allowed" : "pointer",
              transition: "all 0.2s",
              boxShadow: uploading || selectedFiles.length === 0 || !sourceTitle.trim() ? "none" : "0 4px 12px rgba(0, 0, 0, 0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px"
            }}
            onMouseEnter={(e) => {
              if (!(uploading || selectedFiles.length === 0 || !sourceTitle.trim())) {
                e.currentTarget.style.transform = "translateY(-1px)"
                e.currentTarget.style.boxShadow = "0 6px 16px rgba(0, 0, 0, 0.2)"
              }
            }}
            onMouseLeave={(e) => {
              if (!(uploading || selectedFiles.length === 0 || !sourceTitle.trim())) {
                e.currentTarget.style.transform = "translateY(0)"
                e.currentTarget.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.15)"
              }
            }}
          >
            {uploading ? (
              `Uploading ${selectedFiles.length} file${selectedFiles.length !== 1 ? "s" : ""}...`
            ) : (
              `Upload ${selectedFiles.length || ""} file${selectedFiles.length !== 1 ? "s" : ""}`
            )}
          </button>
        </div>

        {/* SOURCE LIST */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "16px",
            padding: "32px",
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
          }}
        >
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "24px"
          }}>
            <div>
              <h3 style={{ fontSize: "18px", fontWeight: 600, color: "#111", margin: "0 0 4px 0" }}>
                📚 Document Library
              </h3>
              <p style={{ fontSize: "14px", color: "#6b7280", margin: 0 }}>
                {sources.length} document{sources.length !== 1 ? 's' : ''} • {sources.filter(s => !s.optimistic).length} ready for research
              </p>
            </div>
            {sources.filter(s => !s.optimistic).length > 0 && (
              <button
                onClick={() => router.push(`/projects/${id}/query`)}
                style={{
                  padding: "10px 20px",
                  background: "#10b981",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "0 2px 4px rgba(16, 185, 129, 0.2)"
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#059669"}
                onMouseLeave={(e) => e.currentTarget.style.background = "#10b981"}
              >
                Start Research →
              </button>
            )}
          </div>

          {sources.length === 0 ? (
            <div style={{
              textAlign: "center",
              padding: "40px 24px",
              color: "#6b7280"
            }}>
              <div style={{ fontSize: "48px", marginBottom: "16px" }}>📄</div>
              <h4 style={{ fontSize: "18px", fontWeight: 600, color: "#374151", marginBottom: "8px" }}>
                Ready to upload your first documents?
              </h4>
              <p style={{ fontSize: "14px", lineHeight: 1.5, maxWidth: "400px", margin: "0 auto" }}>
                Use the upload section above to add legal documents, court cases, or academic sources.
                Start with 3-5 key documents to begin your research.
              </p>
            </div>
          ) : (
            <>
              {/* Source Type Summary */}
              {(() => {
                const typeCounts: Record<string, number> = {}
                for (const s of sources.filter(src => !src.optimistic)) {
                  typeCounts[s.type] = (typeCounts[s.type] || 0) + 1
                }
                const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])
                
                if (sortedTypes.length > 0) {
                  return (
                    <div style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      marginBottom: "20px",
                      padding: "16px",
                      background: "#f9fafb",
                      borderRadius: "10px",
                      border: "1px solid #e5e7eb",
                    }}>
                      <span style={{ fontSize: "13px", color: "#6b7280", fontWeight: 500, marginRight: "4px" }}>
                        Source Types:
                      </span>
                      {sortedTypes.map(([type, count]) => {
                        const getTypeColor = (t: string) => {
                          switch (t) {
                            case "case": return { bg: "#dbeafe", color: "#1e40af", icon: "⚖️" }
                            case "statute": return { bg: "#dcfce7", color: "#166534", icon: "📜" }
                            case "regulation": return { bg: "#e0e7ff", color: "#3730a3", icon: "📋" }
                            case "journal_article": return { bg: "#fef3c7", color: "#854d0e", icon: "📰" }
                            case "book": return { bg: "#fce7f3", color: "#9d174d", icon: "📚" }
                            case "commentary": return { bg: "#f3e8ff", color: "#7c3aed", icon: "💬" }
                            case "constitution": return { bg: "#fef2f2", color: "#991b1b", icon: "🏛️" }
                            case "treaty": return { bg: "#ecfeff", color: "#0e7490", icon: "🌐" }
                            default: return { bg: "#f3f4f6", color: "#374151", icon: "📄" }
                          }
                        }
                        const typeStyle = getTypeColor(type)
                        return (
                          <span
                            key={type}
                            style={{
                              padding: "4px 10px",
                              borderRadius: "16px",
                              background: typeStyle.bg,
                              color: typeStyle.color,
                              fontSize: "12px",
                              fontWeight: 500,
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <span>{typeStyle.icon}</span>
                            <span style={{ textTransform: "capitalize" }}>{type.replace(/_/g, " ")}</span>
                            <span style={{
                              background: "rgba(0,0,0,0.1)",
                              padding: "1px 6px",
                              borderRadius: "10px",
                              fontSize: "11px",
                              fontWeight: 600,
                            }}>
                              {count}
                            </span>
                          </span>
                        )
                      })}
                    </div>
                  )
                }
                return null
              })()}
            
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {sources.map(s => {
                  // Get source type styling
                  const getTypeStyle = (type: string) => {
                    switch (type) {
                      case "case": return { bg: "#dbeafe", color: "#1e40af", icon: "⚖️" }
                      case "statute": return { bg: "#dcfce7", color: "#166534", icon: "📜" }
                      case "regulation": return { bg: "#e0e7ff", color: "#3730a3", icon: "📋" }
                      case "journal_article": return { bg: "#fef3c7", color: "#854d0e", icon: "📰" }
                      case "book": return { bg: "#fce7f3", color: "#9d174d", icon: "📚" }
                      case "commentary": return { bg: "#f3e8ff", color: "#7c3aed", icon: "💬" }
                      case "constitution": return { bg: "#fef2f2", color: "#991b1b", icon: "🏛️" }
                      case "treaty": return { bg: "#ecfeff", color: "#0e7490", icon: "🌐" }
                      default: return { bg: "#f3f4f6", color: "#374151", icon: "📄" }
                    }
                  }
                  const typeStyle = getTypeStyle(s.type)

                  return (
                    <div
                      key={s.id}
                      style={{
                        padding: "20px",
                        border: "1px solid #e5e7eb",
                        borderRadius: "12px",
                        background: "#fff",
                        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                        transition: "all 0.2s",
                        cursor: s.optimistic || deletingSourceId ? "default" : "pointer",
                        opacity: s.optimistic ? 0.7 : 1,
                        borderLeft: `4px solid ${typeStyle.color}`,
                      }}
                      onClick={() =>
                        !s.optimistic && !deletingSourceId && router.push(`/projects/${id}/sources/${s.id}`)
                      }
                      onMouseEnter={(e) => {
                        if (!s.optimistic && deletingSourceId !== s.id) {
                          e.currentTarget.style.transform = "translateY(-2px)"
                          e.currentTarget.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.15)"
                          e.currentTarget.style.borderColor = "#d1d5db"
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!s.optimistic && deletingSourceId !== s.id) {
                          e.currentTarget.style.transform = "translateY(0)"
                          e.currentTarget.style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.1)"
                          e.currentTarget.style.borderColor = "#e5e7eb"
                        }
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                            <span style={{ fontSize: "20px" }}>{typeStyle.icon}</span>
                            <h4 style={{
                              fontSize: "16px",
                              fontWeight: 600,
                              color: "#111",
                              margin: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap"
                            }}>
                              {s.title}
                            </h4>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginLeft: "30px" }}>
                            <span style={{
                              padding: "3px 10px",
                              background: typeStyle.bg,
                              color: typeStyle.color,
                              borderRadius: "12px",
                              fontSize: "11px",
                              fontWeight: 600,
                              textTransform: "uppercase",
                              letterSpacing: "0.5px"
                            }}>
                              {s.type.replace(/_/g, ' ')}
                            </span>

                            {s.optimistic && (
                              <span style={{
                                padding: "3px 10px",
                                background: "#fef3c7",
                                color: "#92400e",
                                borderRadius: "12px",
                                fontSize: "11px",
                                fontWeight: 500,
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                              }}>
                                <span style={{ 
                                  display: "inline-block",
                                  width: "8px",
                                  height: "8px",
                                  background: "#f59e0b",
                                  borderRadius: "50%",
                                  animation: "pulse 1.5s infinite",
                                }}></span>
                                Processing
                              </span>
                            )}

                            <span style={{
                              fontSize: "12px",
                              color: "#6b7280"
                            }}>
                              {new Date(s.created_at).toLocaleDateString()}
                            </span>
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
                              padding: "8px",
                              background: deletingSourceId === s.id ? "#f3f4f6" : "none",
                              border: "1px solid #e5e7eb",
                              borderRadius: "8px",
                              color: deletingSourceId === s.id ? "#9ca3af" : "#ef4444",
                              cursor: deletingSourceId === s.id ? "not-allowed" : "pointer",
                              fontSize: "14px",
                              transition: "all 0.2s",
                              opacity: deletingSourceId === s.id ? 0.6 : 1
                            }}
                            onMouseEnter={(e) => {
                              if (deletingSourceId !== s.id) {
                                e.currentTarget.style.background = "#fef2f2"
                                e.currentTarget.style.borderColor = "#ef4444"
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (deletingSourceId !== s.id) {
                                e.currentTarget.style.background = "none"
                                e.currentTarget.style.borderColor = "#e5e7eb"
                              }
                            }}
                            title="Delete source"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

        </div>
      </div>
      
      {/* Animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
