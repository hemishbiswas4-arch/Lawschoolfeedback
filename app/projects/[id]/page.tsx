// @/app/projects/[id]/page.tsx
"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"

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
      { value: "case", label: "Case Law", description: "Court decisions and judgments" },
      { value: "statute", label: "Statute", description: "Legislation passed by parliament" },
      { value: "regulation", label: "Regulation", description: "Rules made under statutory authority" },
      { value: "constitution", label: "Constitution", description: "Foundational legal documents" },
      { value: "treaty", label: "Treaty", description: "International agreements" },
    ],
  },
  {
    label: "Academic / Secondary",
    description: "Scholarly analysis and interpretation of legal principles",
    recommendation: "Essential for understanding context and scholarly debate",
    options: [
      { value: "journal_article", label: "Journal Article", description: "Peer-reviewed legal scholarship" },
      { value: "book", label: "Book", description: "Comprehensive legal treatises" },
      { value: "commentary", label: "Commentary / Textbook", description: "Explanatory legal texts" },
      { value: "working_paper", label: "Working Paper", description: "Preliminary scholarly work" },
      { value: "thesis", label: "Thesis / Dissertation", description: "Academic research papers" },
    ],
  },
  {
    label: "Policy / Institutional",
    description: "Government and institutional documents and reports",
    recommendation: "Important for policy context and institutional perspectives",
    options: [
      { value: "committee_report", label: "Committee Report", description: "Parliamentary committee findings" },
      { value: "law_commission_report", label: "Law Commission Report", description: "Official law reform recommendations" },
      { value: "white_paper", label: "White Paper", description: "Government policy proposals" },
      { value: "government_report", label: "Government Report", description: "Official government publications" },
    ],
  },
  {
    label: "Digital / Informal",
    description: "Contemporary sources from digital and informal channels",
    recommendation: "Use sparingly for current developments and practical insights",
    options: [
      { value: "blog_post", label: "Blog Post", description: "Expert commentary and analysis" },
      { value: "news_article", label: "News Article", description: "Media coverage of legal issues" },
      { value: "website", label: "Website", description: "Online legal resources and guides" },
      { value: "other", label: "Other", description: "Any other relevant source type" },
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

    // Simulate progress
    let progressValue = 5
    const progressInterval = setInterval(() => {
      progressValue = Math.min(progressValue + 2, 90)
      setUploadProgress(prev => ({ ...prev, [fileId]: progressValue }))
    }, 500)

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
      // Upload files individually to avoid payload size limits
      for (const fileData of filesToUpload) {
        const result = await uploadSingleFile(fileData, user, sourceTitle.trim())
        results.push(result)

        // Add small delay between uploads to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 500))
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
        {/* Enhanced Header */}
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
            marginBottom: "16px",
            flexDirection: "column",
            gap: "12px"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "16px", width: "100%" }}>
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
            </div>
            <h1 style={{
              fontSize: "32px",
              fontWeight: 700,
              color: "#111",
              margin: 0
            }}>
              {project.title}
            </h1>
            <div style={{
              padding: "6px 12px",
              background: "#ecfdf5",
              border: "1px solid #d1fae5",
              borderRadius: "50px",
              fontSize: "12px",
              fontWeight: 600,
              color: "#065f46",
              whiteSpace: "nowrap"
            }}>
              {sources.length} source{sources.length !== 1 ? 's' : ''} uploaded
            </div>
          </div>

          <p style={{ fontSize: "15px", color: "#6b7280", margin: "8px 0 24px 0", lineHeight: 1.5 }}>
            Build your research foundation by uploading legal sources. Start with primary law for comprehensive analysis.
          </p>

          {/* Quick Stats */}
          <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "24px", fontWeight: 700, color: "#111" }}>{sources.length}</div>
              <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: 500 }}>Total Sources</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "24px", fontWeight: 700, color: "#111" }}>
                {sources.filter(s => !s.optimistic).length}
              </div>
              <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: 500 }}>Processed</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "24px", fontWeight: 700, color: "#2563eb" }}>
                {selectedFiles.length}
              </div>
              <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: 500 }}>Ready to Upload</div>
            </div>
          </div>
        </div>

        {/* RECOMMENDATIONS SECTION */}
        {sources.length === 0 && (
          <div style={{
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            padding: "24px",
            marginBottom: "24px"
          }}>
            <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "12px", color: "#111" }}>
              Getting Started
            </h2>
            <p style={{ fontSize: "14px", marginBottom: "16px", color: "#374151", lineHeight: 1.5 }}>
              For optimal research results, begin by uploading primary legal sources such as cases and statutes,
              followed by academic commentary and policy documents.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ padding: "12px", background: "#f9fafb", borderRadius: "6px", border: "1px solid #f3f4f6" }}>
                <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px", color: "#111" }}>Primary Law</h3>
                <p style={{ fontSize: "13px", color: "#6b7280", margin: 0 }}>Cases, statutes, regulations - the foundation of legal research</p>
              </div>
              <div style={{ padding: "12px", background: "#f9fafb", borderRadius: "6px", border: "1px solid #f3f4f6" }}>
                <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px", color: "#111" }}>Academic Sources</h3>
                <p style={{ fontSize: "13px", color: "#6b7280", margin: 0 }}>Journal articles and commentaries for deeper analysis</p>
              </div>
              <div style={{ padding: "12px", background: "#f9fafb", borderRadius: "6px", border: "1px solid #f3f4f6" }}>
                <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px", color: "#111" }}>Policy Documents</h3>
                <p style={{ fontSize: "13px", color: "#6b7280", margin: 0 }}>Government reports and institutional perspectives</p>
              </div>
            </div>
          </div>
        )}

        {/* ADD SOURCE */}
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
            <h3 style={{ fontSize: "18px", fontWeight: 600, color: "#111", margin: 0 }}>
              Upload Sources
            </h3>
            <button
              onClick={() => setShowSourceGuidance(!showSourceGuidance)}
              style={{
                padding: "6px 12px",
                background: "none",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                fontSize: "12px",
                color: "#6b7280",
                cursor: "pointer",
                transition: "all 0.2s"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#9ca3af"
                e.currentTarget.style.color = "#374151"
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#d1d5db"
                e.currentTarget.style.color = "#6b7280"
              }}
            >
              {showSourceGuidance ? "Hide Guide" : "Source Guide"}
            </button>
          </div>

          {/* Source Type Selection with Guidance */}
          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", fontSize: "14px", fontWeight: 600, color: "#374151", marginBottom: "8px" }}>
              Source Type
            </label>
            <select
              value={sourceType}
              onChange={e => setSourceType(e.target.value)}
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
              {SOURCE_CATEGORIES.map(cat => (
                <optgroup key={cat.label} label={`${cat.label} - ${cat.description}`}>
                  {cat.options.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}{opt.description ? ` - ${opt.description}` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            {/* Source Type Guidance */}
            {(() => {
              const selectedCategory = SOURCE_CATEGORIES.find(cat =>
                cat.options.some(opt => opt.value === sourceType)
              )
              const selectedOption = selectedCategory?.options.find(opt => opt.value === sourceType)

              return selectedCategory && (
                <div style={{
                  padding: "12px",
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  marginBottom: "16px"
                }}>
                  <div style={{ fontSize: "13px", color: "#475569", marginBottom: "4px" }}>
                    <strong>{selectedCategory.label}</strong> • {selectedOption?.label}
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.4 }}>
                    {selectedOption?.description}
                  </div>
                </div>
              )
            })()}
          </div>

          {/* Source Guidance Panel */}
          {showSourceGuidance && (
            <div style={{
              marginTop: "16px",
              padding: "50px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "12px"
            }}>
              <h4 style={{ fontSize: "16px", fontWeight: 600, color: "#374151", marginBottom: "16px" }}>
                Source Type Guide
              </h4>
              <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "1fr" }}>
                {SOURCE_CATEGORIES.map(cat => (
                  <div key={cat.label} style={{
                    padding: "16px",
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px"
                  }}>
                    <h5 style={{ fontSize: "14px", fontWeight: 600, color: "#111", marginBottom: "4px" }}>
                      {cat.label}
                    </h5>
                    <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "8px" }}>
                      {cat.description}
                    </p>
                    <p style={{ fontSize: "12px", color: "#374151", fontWeight: 500, marginBottom: "8px", fontStyle: "italic" }}>
                      {cat.recommendation}
                    </p>
                    <div style={{ fontSize: "12px", color: "#64748b" }}>
                      <strong>Types:</strong> {cat.options.map(opt => opt.label).join(", ")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Source Title */}
          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", fontSize: "14px", fontWeight: 600, color: "#374151", marginBottom: "8px" }}>
              Title <span style={{ color: "#ef4444" }}>*</span> {selectedFiles.length > 1 && "(Base title for multiple files)"}
            </label>
            <input
              value={sourceTitle}
              onChange={e => {
                setSourceTitle(e.target.value)
                if (titleError && e.target.value.trim()) {
                  setTitleError("")
                }
              }}
              placeholder={selectedFiles.length > 1 ? "Base title (e.g., 'Supreme Court Cases')" : "Source title"}
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
                padding: "12px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: "6px",
                fontSize: "13px",
                color: "#991b1b"
              }}>
                <div style={{ fontWeight: 600, marginBottom: "4px" }}>⚠️ {titleError}</div>
                <div style={{ fontSize: "12px", color: "#7f1d1d", marginTop: "4px" }}>
                  Please enter a title before uploading. For multiple files, enter a base title that will be used for all files.
                </div>
              </div>
            )}
            {!titleError && selectedFiles.length > 0 && (
              <div style={{
                marginTop: "8px",
                fontSize: "12px",
                color: "#6b7280"
              }}>
                {selectedFiles.length > 1 
                  ? `Each file will be named: "${sourceTitle.trim() || "[Your Title]"} — [filename]"`
                  : "This title will be used to identify your source"}
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
              gap: "24px",
              fontSize: "12px",
              color: "#6b7280",
              flexWrap: "wrap"
            }}>
              <span>Maximum 200MB per file</span>
              <span>Up to 50 files</span>
              <span>PDF format only</span>
              <span>Large uploads may take several minutes to process</span>
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
              <h4 style={{ fontSize: "16px", fontWeight: 600, color: "#374151", marginBottom: "16px" }}>
                Upload Progress
              </h4>
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
          <div style={{ marginBottom: "24px" }}>
            <h3 style={{ fontSize: "18px", fontWeight: 600, color: "#111", margin: 0 }}>
              Sources ({sources.length})
            </h3>
          </div>

          {sources.length === 0 ? (
            <div style={{
              textAlign: "center",
              padding: "32px 24px",
              color: "#6b7280"
            }}>
              <h4 style={{ fontSize: "16px", fontWeight: 600, color: "#374151", marginBottom: "8px" }}>
                No sources yet
              </h4>
              <p style={{ fontSize: "14px", lineHeight: 1.5 }}>
                Upload legal documents above to begin your research.
                Start with primary law sources such as cases and statutes.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {sources.map(s => {
                // Get source category
                const getSourceCategory = (type: string) => {
                  for (const cat of SOURCE_CATEGORIES) {
                    if (cat.options.some(opt => opt.value === type)) {
                      return cat
                    }
                  }
                  return null
                }

                const category = getSourceCategory(s.type)

                return (
                  <div
                    key={s.id}
                    style={{
                      padding: "50px",
                      border: "1px solid #e5e7eb",
                      borderRadius: "12px",
                      background: "#fff",
                      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                      transition: "all 0.2s",
                      cursor: s.optimistic || deletingSourceId ? "default" : "pointer",
                      opacity: s.optimistic ? 0.7 : 1,
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
                        <h4 style={{
                          fontSize: "16px",
                          fontWeight: 600,
                          color: "#111",
                          margin: "0 0 8px 0",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap"
                        }}>
                          {s.title}
                        </h4>

                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <span style={{
                            padding: "2px 6px",
                            background: "#f3f4f6",
                            color: "#374151",
                            borderRadius: "4px",
                            fontSize: "11px",
                            fontWeight: 500,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em"
                          }}>
                            {s.type.replace(/_/g, ' ')}
                          </span>

                          {s.optimistic && (
                            <span style={{
                              padding: "2px 6px",
                              background: "#f3f4f6",
                              color: "#6b7280",
                              borderRadius: "4px",
                              fontSize: "11px",
                              fontWeight: 500
                            }}>
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
                          {deletingSourceId === s.id ? "🗑️" : "🗑️"}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {sources.length > 0 && (
            <div             style={{
              marginTop: "24px",
              padding: "16px",
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: "6px",
              textAlign: "center"
            }}>
              <p style={{ fontSize: "14px", color: "#6b7280", marginBottom: "12px" }}>
                Ready to analyze your sources? Click the button above to start your research.
              </p>
              <button
                onClick={() => router.push(`/projects/${id}/query`)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "4px",
                  background: "#111",
                  color: "#fff",
                  fontSize: "14px",
                  fontWeight: 500,
                  border: "none",
                  cursor: "pointer"
                }}
              >
                Continue to Research
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
