"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import Link from "next/link"

/* ================= TYPES ================= */

type DocumentType =
  | "moot"
  | "negotiation"
  | "research"
  | "bibliography"
  | "assignment"
  | "draft"

type FileWithPreview = {
  file: File
  id: string
  preview: string
}

type UploadedDoc = {
  id: string
  title: string
  created_at: string
}

const DOCUMENT_TYPES: { value: DocumentType; label: string }[] = [
  { value: "moot", label: "Moot Memorial / Written Submissions" },
  { value: "negotiation", label: "Negotiation Plan / Strategy" },
  { value: "research", label: "Research Paper / Project" },
  { value: "bibliography", label: "Bibliography / Sources" },
  { value: "assignment", label: "Assignment / Essay" },
  { value: "draft", label: "General Draft / Other" },
]

/* ================= PAGE ================= */

export default function Page() {
  const router = useRouter()

  const [files, setFiles] = useState<FileWithPreview[]>([])
  const [docType, setDocType] = useState<DocumentType>("draft")
  const [loading, setLoading] = useState(false)
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([])

  /* ================= AUTH GUARD + LOAD DOCS ================= */

  useEffect(() => {
    const load = async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session?.user) {
        router.replace("/login")
        return
      }

      // Load recent documents
      const { data: docs } = await supabase
        .from("documents")
        .select("id, title, created_at")
        .eq("owner_id", sessionData.session.user.id)
        .order("created_at", { ascending: false })
        .limit(10)

      if (docs) {
        setUploadedDocs(docs)
      }
    }

    load()
  }, [router])

  /* ================= FILE HANDLING ================= */

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || [])
    const pdfFiles = selectedFiles.filter(f => f.type === "application/pdf")
    
    if (selectedFiles.length !== pdfFiles.length) {
      alert("Only PDF files are supported. Non-PDF files were ignored.")
    }

    const newFiles: FileWithPreview[] = pdfFiles.map(file => ({
      file,
      id: `${Date.now()}-${Math.random()}`,
      preview: file.name,
    }))

    setFiles(prev => [...prev, ...newFiles])
  }

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  const deleteDocument = async (docId: string, title: string) => {
    if (!confirm(`Delete "${title}"?`)) return

    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData.session?.user

    if (!user) return

    try {
      // Get storage path before deleting
      const { data: doc } = await supabase
        .from("documents")
        .select("storage_path")
        .eq("id", docId)
        .eq("owner_id", user.id)
        .single()

      // Delete from database
      const { error: deleteError } = await supabase
        .from("documents")
        .delete()
        .eq("id", docId)
        .eq("owner_id", user.id)

      if (deleteError) throw deleteError

      // Delete from storage if path exists
      if (doc?.storage_path) {
        await supabase.storage
          .from("document uploads")
          .remove([doc.storage_path])
      }

      // Refresh list
      setUploadedDocs(prev => prev.filter(d => d.id !== docId))
    } catch (err: any) {
      alert(err.message || "Failed to delete document.")
    }
  }

  /* ================= UPLOAD ================= */

  const uploadPdfs = async () => {
    if (files.length === 0 || loading) return

    setLoading(true)

    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData.session?.user

    if (!user) {
      alert("Session not ready. Please reload and try again.")
      setLoading(false)
      return
    }

    try {
      const uploadPromises = files.map(async (fileWithPreview) => {
        const file = fileWithPreview.file
        const storagePath = `${user.id}/${Date.now()}-${file.name}`

        /* 1) Upload PDF */
        const { error: uploadError } = await supabase.storage
          .from("document uploads")
          .upload(storagePath, file, {
            contentType: "application/pdf",
          })

        if (uploadError) throw uploadError

        /* 2) Insert document metadata */
        const { data: doc, error: insertError } = await supabase
          .from("documents")
          .insert({
            owner_id: user.id,
            title: file.name,
            storage_path: storagePath,
            document_type: docType,
          })
          .select("id")
          .single()

        if (insertError || !doc) {
          await supabase.storage
            .from("document uploads")
            .remove([storagePath])
          throw insertError || new Error("Failed to save document.")
        }

        return doc
      })

      await Promise.all(uploadPromises)

      // Refresh documents list
      const { data: docs } = await supabase
        .from("documents")
        .select("id, title, created_at")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10)

      if (docs) {
        setUploadedDocs(docs)
      }

      setFiles([])
      setLoading(false)
    } catch (err: any) {
      alert(err.message || "Upload failed.")
      setLoading(false)
    }
  }

  /* ================= STYLES ================= */

  const styles = {
    container: {
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#f9fafb",
      fontFamily: "sans-serif",
      color: "#111",
      padding: "20px",
    },
    card: {
      width: "100%",
      maxWidth: "480px",
      backgroundColor: "#ffffff",
      borderRadius: "12px",
      border: "1px solid #e5e7eb",
      boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
      padding: "32px",
    },
    header: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: "24px",
    },
    backButton: {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      background: "none",
      border: "none",
      color: "#6b7280",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: 500,
      padding: 0,
    },
    title: {
      fontSize: "20px",
      fontWeight: 700,
      color: "#111",
      margin: 0,
    },
    betaNotice: {
      backgroundColor: "#fffbeb", // Amber-50
      border: "1px solid #fcd34d", // Amber-300
      color: "#92400e", // Amber-800
      padding: "12px 16px",
      borderRadius: "8px",
      fontSize: "13px",
      lineHeight: 1.5,
      marginBottom: "24px",
      display: "flex",
      gap: "10px",
      alignItems: "flex-start",
    },
    formGroup: {
      marginBottom: "20px",
    },
    label: {
      display: "block",
      fontSize: "12px",
      fontWeight: 600,
      color: "#374151",
      textTransform: "uppercase" as const,
      letterSpacing: "0.05em",
      marginBottom: "8px",
    },
    select: {
      width: "100%",
      padding: "10px 12px",
      borderRadius: "8px",
      border: "1px solid #d1d5db",
      backgroundColor: "#fff",
      fontSize: "14px",
      color: "#111",
      outline: "none",
    },
    fileInputWrapper: {
      position: "relative" as const,
      width: "100%",
    },
    fileInput: {
      width: "100%",
      padding: "10px",
      borderRadius: "8px",
      border: "1px solid #d1d5db",
      backgroundColor: "#f9fafb",
      fontSize: "14px",
      color: "#374151",
      cursor: "pointer",
      boxSizing: "border-box" as const,
    },
    button: {
      width: "100%",
      padding: "12px",
      backgroundColor: "#111",
      color: "#fff",
      border: "none",
      borderRadius: "8px",
      fontSize: "14px",
      fontWeight: 600,
      cursor: loading || files.length === 0 ? "not-allowed" : "pointer",
      opacity: loading || files.length === 0 ? 0.5 : 1,
      marginTop: "8px",
      transition: "background 0.2s",
    }
  }

  /* ================= RENDER ================= */

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        
        {/* HEADER */}
        <div style={styles.header}>
          <h1 style={styles.title}>Upload Document</h1>
          <button onClick={() => router.back()} style={styles.backButton}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            Cancel
          </button>
        </div>

        {/* NOTICE */}
        <div style={styles.betaNotice}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginTop: "2px", flexShrink: 0 }}><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <div>
            <strong>Beta Requirement:</strong> To ensure precise highlighting and feedback anchoring, please upload <strong>PDF files only</strong> at this stage.
          </div>
        </div>

        {/* FORM */}
        <div style={styles.formGroup}>
          <label style={styles.label}>
            Category
          </label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value as DocumentType)}
            disabled={loading}
            style={styles.select}
          >
            {DOCUMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>
            Select Files (PDF only)
          </label>
          <input
            type="file"
            accept="application/pdf"
            multiple
            disabled={loading}
            onChange={handleFileSelect}
            style={styles.fileInput}
          />
          
          {files.length > 0 && (
            <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
              {files.map((fileWithPreview) => (
                <div
                  key={fileWithPreview.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    background: "#f9fafb",
                    borderRadius: "6px",
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 500, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {fileWithPreview.file.name}
                    </div>
                    <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                      {(fileWithPreview.file.size / 1024 / 1024).toFixed(2)} MB
                    </div>
                  </div>
                  <button
                    onClick={() => removeFile(fileWithPreview.id)}
                    disabled={loading}
                    style={{
                      marginLeft: "12px",
                      padding: "4px 8px",
                      background: "none",
                      border: "none",
                      color: "#dc2626",
                      cursor: loading ? "not-allowed" : "pointer",
                      fontSize: "12px",
                      fontWeight: 500,
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={uploadPdfs}
          disabled={loading || files.length === 0}
          style={styles.button}
        >
          {loading ? `Uploading ${files.length} file(s)...` : `Upload ${files.length} file${files.length !== 1 ? 's' : ''}`}
        </button>

        {/* RECENT DOCUMENTS */}
        {uploadedDocs.length > 0 && (
          <div style={{ marginTop: "32px", paddingTop: "24px", borderTop: "1px solid #e5e7eb" }}>
            <h2 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "16px", color: "#374151" }}>
              Recent Documents
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {uploadedDocs.map((doc) => (
                <div
                  key={doc.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    background: "#fff",
                    borderRadius: "6px",
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 500, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {doc.title}
                    </div>
                    <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                      {new Date(doc.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteDocument(doc.id, doc.title)}
                    disabled={loading}
                    style={{
                      marginLeft: "12px",
                      padding: "4px 8px",
                      background: "none",
                      border: "none",
                      color: "#dc2626",
                      cursor: loading ? "not-allowed" : "pointer",
                      fontSize: "12px",
                      fontWeight: 500,
                    }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* QUICK NAVIGATION */}
        <div style={{ marginTop: "24px", paddingTop: "24px", borderTop: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#6b7280", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Quick Navigation
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Link
              href="/projects"
              style={{
                padding: "8px 12px",
                borderRadius: "6px",
                background: "#f3f4f6",
                color: "#374151",
                fontSize: "13px",
                fontWeight: 500,
                textDecoration: "none",
                border: "1px solid #e5e7eb",
              }}
            >
              View Projects
            </Link>
            <Link
              href="/projects/new"
              style={{
                padding: "8px 12px",
                borderRadius: "6px",
                background: "#111",
                color: "#fff",
                fontSize: "13px",
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              New Project
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}