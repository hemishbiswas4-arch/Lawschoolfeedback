"use client"

import { useEffect, useState, useRef } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useParams, useRouter } from "next/navigation"
import { DocumentRole } from "@/types/document"
import { createNotification } from "@/lib/notifications"
import { LENS_REGISTRY, LensSeverity } from "@/lib/lenses"

/* ================= TYPES ================= */

type SelectionPayload = {
  text: string
  page: number
  rects: {
    left: number
    top: number
    width: number
    height: number
  }[]
}

type Comment = {
  id: string
  author_id: string
  author_email: string
  content: string
  anchor_json: SelectionPayload
  created_at: string
  lens_type: string | null
  lens_payload: Record<string, string> | null
  severity: LensSeverity | null
}

/* ================= PAGE ================= */

export default function DocumentViewerPage() {
  const { id: documentId } = useParams() as { id: string }
  const router = useRouter()
  
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const [role, setRole] = useState<DocumentRole | null>(null)
  const [userId, setUserId] = useState("")
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [documentType, setDocumentType] = useState<string | null>(null)
  const [documentOwnerId, setDocumentOwnerId] = useState<string | null>(null)

  const [comments, setComments] = useState<Comment[]>([])
  const [selection, setSelection] = useState<SelectionPayload | null>(null)
  const [newComment, setNewComment] = useState("")

  /* ───── Structured feedback state ───── */
  const [selectedLens, setSelectedLens] = useState<string | null>(null)
  const [lensPayload, setLensPayload] = useState<Record<string, string>>({})
  const [severity, setSeverity] = useState<LensSeverity | null>(null)

  const availableLenses = documentType
    ? Object.entries(LENS_REGISTRY[documentType] ?? {})
    : []

  /* ================= AUTH + ACCESS ================= */

  useEffect(() => {
    const init = async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      const user = sessionData?.session?.user
      if (!user) {
        router.push("/login")
        return
      }
      setUserId(user.id)

      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("document_id", documentId)
        .eq("user_id", user.id)
        .in("notification_type", ["comment_added", "comment_reply"])
        .eq("is_read", false)

      const { data: access } = await supabase
        .from("document_shares")
        .select("role")
        .eq("document_id", documentId)
        .eq("shared_with", user.id)
        .single()

      if (!access?.role) {
        router.push("/dashboard")
        return
      }
      setRole(access.role)

      const { data: doc } = await supabase
        .from("documents")
        .select("storage_path, owner_id, document_type")
        .eq("id", documentId)
        .single()

      if (!doc?.storage_path) return
      setDocumentOwnerId(doc.owner_id)
      setDocumentType(doc.document_type)

      const { data: signed } = await supabase.storage
        .from("document uploads")
        .createSignedUrl(doc.storage_path, 3600)

      if (!signed?.signedUrl) return
      setSignedUrl(signed.signedUrl)
    }

    init()
  }, [documentId, router])

  /* ================= LOAD COMMENTS ================= */

  const loadComments = async () => {
    const { data } = await supabase
      .from("document_comments")
      .select("*")
      .eq("document_id", documentId)
      .order("created_at", { ascending: false })

    if (!data) return

    const authorIds = [...new Set(data.map((c) => c.author_id))]
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id,email")
      .in("id", authorIds)

    const emailMap = new Map(profiles?.map((p) => [p.id, p.email]) ?? [])

    setComments(
      data.map((c) => ({
        ...c,
        author_email: emailMap.get(c.author_id) ?? "Unknown",
      }))
    )
  }

  useEffect(() => {
    if (signedUrl) loadComments()
  }, [signedUrl])

  /* ================= PDF SELECTION ================= */

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== "PDF_SELECTION") return

      setSelection(e.data.payload)

      // Send PREVIEW to iframe (Temporary Highlight)
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: "PREVIEW_HIGHLIGHT",
          payload: {
            page: e.data.payload.page,
            rects: e.data.payload.rects,
          }
        },
        "*"
      )
    }

    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [])

  /* ================= SUBMIT COMMENT ================= */

  const submitComment = async () => {
    if (!selection || !newComment.trim()) return
    if (!userId || !documentId || !documentType) return

    if (selectedLens) {
      const allowed = LENS_REGISTRY[documentType]
      if (!allowed || !allowed[selectedLens]) return
    }

    const payload = {
      document_id: documentId,
      author_id: userId,
      page_number: selection.page,
      content: newComment.trim(),
      anchor_json: selection,
      lens_type: selectedLens,
      lens_payload: selectedLens ? lensPayload : null,
      severity,
    }

    // 1. Insert Comment
    const { data: savedComment, error } = await supabase
        .from("document_comments")
        .insert(payload)
        .select()
        .single();

    if (error) return

    // 2. Notifications
    const { data: collaborators } = await supabase
      .from("document_shares")
      .select("shared_with")
      .eq("document_id", documentId)

    if (documentOwnerId && documentOwnerId !== userId) {
      await createNotification({
        userId: documentOwnerId,
        actorId: userId,
        documentId,
        documentType,
        type: "comment_added",
        message: "New comment on your document",
      })
    }

    for (const c of collaborators ?? []) {
      if (c.shared_with === userId) continue
      if (c.shared_with === documentOwnerId) continue

      await createNotification({
        userId: c.shared_with,
        actorId: userId,
        documentId,
        documentType,
        type: "comment_added",
        message: "New comment on a document shared with you",
      })
    }

    // 3. CLEANUP (Fixes Ghosting)
    // Clear the temporary preview highlight immediately
    iframeRef.current?.contentWindow?.postMessage({ type: "CLEAR_ALL_HIGHLIGHTS" }, "*")

    // 4. Reset State
    setNewComment("")
    setSelection(null)
    setSelectedLens(null)
    setLensPayload({})
    setSeverity(null)

    // 5. Draw the PERMANENT highlight
    await loadComments() 
    if (savedComment) {
       iframeRef.current?.contentWindow?.postMessage({
        type: "SET_COMMENT_HIGHLIGHTS",
        payload: {
          page: savedComment.anchor_json.page,
          rects: savedComment.anchor_json.rects,
        }
       }, "*")
    }
  }

  /* ================= HELPER STYLES ================= */
  
  const styles = {
    container: { display: "flex", height: "100vh", overflow: "hidden", fontFamily: "sans-serif", backgroundColor: "#fff" },
    leftPanel: { flex: 1, height: "100%", position: "relative" as const, borderRight: "1px solid #e5e7eb", backgroundColor: "#f3f4f6" },
    iframe: { width: "100%", height: "100%", border: "none" },
    sidebar: { width: "400px", height: "100%", display: "flex", flexDirection: "column" as const, backgroundColor: "#fff", boxShadow: "-4px 0 15px -3px rgba(0,0,0,0.05)" },
    header: { padding: "16px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" },
    scrollArea: { flex: 1, overflowY: "auto" as const, padding: "20px" },
    
    // UI Elements
    backButton: { display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid #e5e7eb", borderRadius: "6px", width: "32px", height: "32px", cursor: "pointer", color: "#4b5563", marginRight: "12px" },
    card: { backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px", marginBottom: "16px", fontSize: "14px" },
    activeCard: { backgroundColor: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "8px", padding: "16px", marginBottom: "20px", boxShadow: "0 2px 5px rgba(0,0,0,0.05)" },
    input: { width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db", marginBottom: "12px", fontSize: "14px", boxSizing: "border-box" as const },
    buttonPrimary: { backgroundColor: "#111827", color: "#fff", padding: "6px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: 500, border: "none", cursor: "pointer" },
    buttonSecondary: { backgroundColor: "transparent", color: "#6b7280", padding: "6px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: 500, border: "none", cursor: "pointer", marginRight: "8px" },
    
    badge: { display: "inline-flex", alignItems: "center", padding: "2px 6px", borderRadius: "4px", fontSize: "11px", fontWeight: 600, marginRight: "6px" },
  }

  /* ================= UI ================= */

  if (!signedUrl) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#666' }}>
        Loading document workspace...
      </div>
    )
  }

  return (
    <div style={styles.container}>
      {/* LEFT: PDF VIEWER */}
      <div style={styles.leftPanel}>
        <iframe
          ref={iframeRef}
          src={`/pdf-viewer.html?file=${encodeURIComponent(signedUrl)}`}
          style={styles.iframe}
        />
      </div>

      {/* RIGHT: SIDEBAR */}
      <div style={styles.sidebar}>
        
        {/* SIDEBAR HEADER */}
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button 
              onClick={() => router.push('/dashboard')} 
              style={styles.backButton}
              title="Back to Dashboard"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
            </button>
            <div>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "#111" }}>Review Panel</h3>
              <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#6b7280" }}>
                {comments.length} comment{comments.length !== 1 && "s"} total
              </p>
            </div>
          </div>
          <div style={{ padding: "4px 8px", background: "#f3f4f6", borderRadius: "4px", fontSize: "11px", fontFamily: "monospace", color: "#4b5563", border: "1px solid #e5e7eb" }}>
            BETA
          </div>
        </div>

        {/* CONTENT AREA */}
        <div style={styles.scrollArea}>
          
          {/* DRAFTING CARD */}
          {selection && role !== "viewer" && (
            <div style={styles.activeCard}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <div style={{ flex: 1, backgroundColor: "#fff", borderRadius: "4px", padding: "6px 8px", fontSize: "12px", color: "#6b7280", border: "1px solid #e5e7eb", fontStyle: "italic" }}>
                  "{selection.text}"
                </div>
              </div>

              {availableLenses.length > 0 && (
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#374151", textTransform: "uppercase", marginBottom: "6px" }}>
                    Feedback Lens
                  </label>
                  <select
                    value={selectedLens ?? ""}
                    onChange={(e) => {
                      const v = e.target.value || null
                      setSelectedLens(v)
                      setLensPayload({})
                      setSeverity(null)
                    }}
                    style={styles.input}
                  >
                    <option value="">General Comment</option>
                    {availableLenses.map(([k, def]) => (
                      <option key={k} value={k}>
                        {def.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {selectedLens && (
                <div style={{ marginBottom: "12px" }}>
                  {Object.keys(
                    LENS_REGISTRY[documentType!][selectedLens].payloadSchema
                  ).map((field) => (
                    <div key={field}>
                      <input
                        placeholder={
                          field === "issue" ? "What is the issue?" :
                          field === "problem" ? "Why is this a problem?" :
                          field === "gap" ? "What is missing?" :
                          field.replace(/_/g, " ")
                        }
                        value={lensPayload[field] ?? ""}
                        onChange={(e) =>
                          setLensPayload((p) => ({ ...p, [field]: e.target.value }))
                        }
                        style={styles.input}
                      />
                    </div>
                  ))}
                  
                  <div style={{ marginTop: '12px' }}>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#374151", textTransform: "uppercase", marginBottom: "6px" }}>
                      Severity
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {["note", "issue", "critical"].map((s) => (
                        <button
                          key={s}
                          onClick={() => setSeverity(s as LensSeverity)}
                          style={{
                            flex: 1,
                            padding: "6px",
                            fontSize: "12px",
                            borderRadius: "4px",
                            cursor: "pointer",
                            border: severity === s ? `1px solid #000` : "1px solid #e5e7eb",
                            backgroundColor: severity === s ? "#fff" : "#f9fafb",
                            color: severity === s ? "#000" : "#6b7280"
                          }}
                        >
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Write your analysis here..."
                style={{ ...styles.input, minHeight: "100px", resize: "none" }}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                <button 
                  onClick={() => {
                    setSelection(null);
                    iframeRef.current?.contentWindow?.postMessage({ type: "CLEAR_ALL_HIGHLIGHTS" }, "*")
                  }}
                  style={styles.buttonSecondary}
                >
                  Cancel
                </button>
                <button 
                  onClick={submitComment}
                  disabled={!newComment.trim()} 
                  style={{ ...styles.buttonPrimary, opacity: !newComment.trim() ? 0.5 : 1 }}
                >
                  Post Feedback
                </button>
              </div>
            </div>
          )}

          {/* COMMENTS LIST */}
          <div style={{ paddingBottom: "40px" }}>
            {comments.length === 0 && !selection && (
               <div style={{ textAlign: "center", padding: "40px 20px" }}>
                 <p style={{ fontSize: "14px", color: "#6b7280" }}>No comments yet.</p>
                 <p style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>Select text on the document to start.</p>
               </div>
            )}

            {comments.map((c) => (
              <div key={c.id} style={styles.card}>
                {/* Comment Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: '#374151', color: '#fff', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {c.author_email.charAt(0).toUpperCase()}
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#111' }}>
                      {c.author_email}
                    </span>
                  </div>
                  <span style={{ fontSize: '10px', color: '#9ca3af' }}>
                    {new Date(c.created_at).toLocaleDateString()}
                  </span>
                </div>

                {/* Tags */}
                {(c.lens_type || c.severity) && (
                  <div style={{ marginBottom: '10px' }}>
                    {c.lens_type && (
                      <span style={{ ...styles.badge, backgroundColor: "#f3f4f6", color: "#4b5563", border: "1px solid #e5e7eb" }}>
                        {c.lens_type.replace(/_/g, ' ')}
                      </span>
                    )}
                    {c.severity && (
                      <span style={{ 
                        ...styles.badge, 
                        backgroundColor: c.severity === 'critical' ? '#fecaca' : c.severity === 'issue' ? '#ffedd5' : '#dbeafe', 
                        color: c.severity === 'critical' ? '#991b1b' : c.severity === 'issue' ? '#9a3412' : '#1e40af' 
                      }}>
                        {c.severity}
                      </span>
                    )}
                  </div>
                )}

                {/* Content */}
                <div style={{ fontSize: "14px", color: "#374151", lineHeight: "1.5", marginBottom: "12px" }}>
                  {c.content}
                </div>

                {/* Actions */}
                <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "8px", borderTop: "1px solid #f3f4f6" }}>
                  <button
                    onClick={() => {
                      iframeRef.current?.contentWindow?.postMessage(
                        { type: "CLEAR_ALL_HIGHLIGHTS" },
                        "*"
                      )
                      iframeRef.current?.contentWindow?.postMessage(
                        {
                          type: "SET_COMMENT_HIGHLIGHTS",
                          payload: {
                            page: c.anchor_json.page,
                            rects: c.anchor_json.rects,
                          }
                        },
                        "*"
                      )
                    }}
                    style={{ background: "none", border: "none", color: "#2563eb", fontSize: "12px", cursor: "pointer", padding: 0 }}
                  >
                    Locate
                  </button>

                  {(role === "owner" || c.author_id === userId) && (
                    <button
                      onClick={async () => {
                        await supabase
                          .from("document_comments")
                          .delete()
                          .eq("id", c.id)
                        loadComments()
                        iframeRef.current?.contentWindow?.postMessage(
                          { type: "CLEAR_ALL_HIGHLIGHTS" },
                          "*"
                        )
                      }}
                      style={{ background: "none", border: "none", color: "#ef4444", fontSize: "12px", cursor: "pointer", padding: 0 }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}