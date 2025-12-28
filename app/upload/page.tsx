"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"

/* ================= TYPES ================= */

type DocumentType =
  | "moot"
  | "negotiation"
  | "research"
  | "bibliography"
  | "assignment"
  | "draft"

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

  const [file, setFile] = useState<File | null>(null)
  const [docType, setDocType] = useState<DocumentType>("draft")
  const [loading, setLoading] = useState(false)

  /* ================= AUTH GUARD ================= */

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session?.user) {
        router.replace("/login")
      }
    })
  }, [router])

  /* ================= UPLOAD ================= */

  const uploadPdf = async () => {
    if (!file || loading) return

    if (file.type !== "application/pdf") {
      alert("Only PDF files are supported in the beta.")
      return
    }

    setLoading(true)

    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData.session?.user

    if (!user) {
      alert("Session not ready. Please reload and try again.")
      setLoading(false)
      return
    }

    const storagePath = `${user.id}/${Date.now()}-${file.name}`

    try {
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

      router.replace("/dashboard")
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
      cursor: loading || !file ? "not-allowed" : "pointer",
      opacity: loading || !file ? 0.5 : 1,
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
            Select File
          </label>
          <input
            type="file"
            accept="application/pdf"
            disabled={loading}
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            style={styles.fileInput}
          />
          {file && (
            <div style={{ marginTop: "8px", fontSize: "12px", color: "#6b7280" }}>
              Selected: <span style={{ fontWeight: 500, color: "#111" }}>{file.name}</span> ({(file.size / 1024 / 1024).toFixed(2)} MB)
            </div>
          )}
        </div>

        <button
          onClick={uploadPdf}
          disabled={loading || !file}
          style={styles.button}
        >
          {loading ? "Uploading Document..." : "Upload and Continue"}
        </button>
      </div>
    </div>
  )
}