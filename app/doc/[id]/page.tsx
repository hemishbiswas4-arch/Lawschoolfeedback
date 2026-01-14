// @/app/doc/[id]/page.tsx
"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"

type Comment = {
  id: string
  content: string
  author_id: string
  created_at: string
}

export default function DocumentViewerPage() {
  const params = useParams()
  const documentId = params.id as string
  const router = useRouter()

  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pageNumber, setPageNumber] = useState<number>(1)

  const [comments, setComments] = useState<Comment[]>([])
  const [newComment, setNewComment] = useState("")
  const [loading, setLoading] = useState(true)

  /* ---------------- Load document + signed URL ---------------- */
  useEffect(() => {
    const load = async () => {
      console.log("[INIT] Viewer mounted", documentId)

      const { data: session } = await supabase.auth.getSession()
      if (!session.session?.user) {
        router.push("/login")
        return
      }

      const { data: doc, error } = await supabase
        .from("documents")
        .select("storage_path")
        .eq("id", documentId)
        .single()

      if (error || !doc) {
        alert("Document not found or access denied.")
        router.push("/dashboard")
        return
      }

      const { data: signed } = await supabase.storage
        .from("document uploads")
        .createSignedUrl(doc.storage_path, 60 * 60)

      if (!signed?.signedUrl) {
        alert("Failed to load document.")
        router.push("/dashboard")
        return
      }

      console.log("[STORAGE] Signed URL ready")
      setPdfUrl(signed.signedUrl)
      setLoading(false)
    }

    load()
  }, [documentId])

  /* ---------------- Load comments for page ---------------- */
  const loadComments = async (page: number) => {
    const { data } = await supabase
      .from("document_comments")
      .select("id, content, author_id, created_at")
      .eq("document_id", documentId)
      .eq("page_number", page)
      .order("created_at", { ascending: true })

    setComments(data || [])
  }

  useEffect(() => {
    if (pdfUrl) loadComments(pageNumber)
  }, [pageNumber, pdfUrl])

  /* ---------------- Add comment ---------------- */
  const submitComment = async () => {
    if (!newComment.trim()) return

    const { error } = await supabase
      .from("document_comments")
      .insert({
        document_id: documentId,
        page_number: pageNumber,
        content: newComment.trim(),
      })

    if (error) {
      alert("You don’t have permission to comment.")
      return
    }

    setNewComment("")
    loadComments(pageNumber)
  }

  if (loading || !pdfUrl) {
    return <p style={{ padding: "2rem" }}>Loading document…</p>
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* ---------------- PDF VIEWER ---------------- */}
      <div style={{ flex: 2, padding: "1rem" }}>
        <iframe
          src={`${pdfUrl}#page=${pageNumber}`}
          style={{
            width: "100%",
            height: "100%",
            border: "1px solid #ccc",
          }}
        />
      </div>

      {/* ---------------- COMMENTS ---------------- */}
      <div
        style={{
          flex: 1,
          borderLeft: "1px solid #ddd",
          padding: "1rem",
          overflowY: "auto",
        }}
      >
        <div style={{ marginBottom: "16px" }}>
          <Link
            href="/dashboard"
            style={{
              padding: "6px 12px",
              borderRadius: "4px",
              background: "#ffffff",
              color: "#374151",
              fontSize: "12px",
              fontWeight: 500,
              textDecoration: "none",
              border: "1px solid #e5e7eb",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              transition: "all 0.2s"
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f9fafb"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#ffffff"
            }}
          >
            ← Back to Dashboard
          </Link>
        </div>
        <h3>Comments (Page {pageNumber})</h3>

        <div style={{ marginBottom: "0.5rem" }}>
          <button onClick={() => setPageNumber((p) => Math.max(1, p - 1))}>
            ◀ Prev Page
          </button>
          <button
            onClick={() => setPageNumber((p) => p + 1)}
            style={{ marginLeft: "0.5rem" }}
          >
            Next Page ▶
          </button>
        </div>

        {comments.length === 0 ? (
          <p>No comments on this page.</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} style={{ marginBottom: "0.75rem" }}>
              <div>{c.content}</div>
              <small style={{ color: "#666" }}>
                {new Date(c.created_at).toLocaleString()}
              </small>
            </div>
          ))
        )}

        <textarea
          placeholder="Add a comment…"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          style={{ width: "100%", marginTop: "1rem" }}
        />

        <button onClick={submitComment} style={{ marginTop: "0.5rem" }}>
          Add Comment
        </button>
      </div>
    </div>
  )
}
