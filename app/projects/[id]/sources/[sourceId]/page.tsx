// @/app/projects/[id]/sources/[sourceId]/page.tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { useParams, usePathname } from "next/navigation"
import Link from "next/link"

/* ================= PAGE ================= */

export default function SourceDetailPage() {
  console.log("▶️ SourceDetailPage render")

  const params = useParams<{ id?: string; sourceId?: string }>()
  const pathname = usePathname()

  const projectId = typeof params.id === "string" ? params.id : null
  const sourceId = typeof params.sourceId === "string" ? params.sourceId : null

  const [chunks, setChunks] = useState<any[]>([])
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [loadingChunks, setLoadingChunks] = useState(true)
  const [progress, setProgress] = useState(0)

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const lastChunkCountRef = useRef(0)
  const stableTicksRef = useRef(0)

  /* ================= ROUTE GUARD ================= */

  if (!projectId || !sourceId) {
    return (
      <div style={{ padding: "40px", color: "#b91c1c" }}>
        <h2>Invalid source route</h2>
        <code>{pathname}</code>
      </div>
    )
  }

  /* ================= LOAD PDF URL ================= */

  useEffect(() => {
    const loadPdfUrl = async () => {
      try {
        const res = await fetch(`/api/sources/${sourceId}/pdf`)
        if (!res.ok) return
        const { url } = await res.json()
        setPdfUrl(url)
      } catch (e) {
        console.error("❌ pdf fetch error:", e)
      }
    }

    loadPdfUrl()
  }, [sourceId])

  /* ================= POLL CHUNKS + PROGRESS ================= */

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch(`/api/sources/${sourceId}/chunks`)
        if (!res.ok) return

        const json = await res.json()
        if (!Array.isArray(json) || cancelled) return

        setChunks(json)

        const current = json.length
        const last = lastChunkCountRef.current

        if (current > last) {
          lastChunkCountRef.current = current
          stableTicksRef.current = 0
        } else {
          stableTicksRef.current++
        }

        const inferred = Math.min(
          95,
          Math.round(Math.log(current + 1) * 25)
        )

        setProgress(inferred)

        if (stableTicksRef.current >= 3) {
          setProgress(100)
          setLoadingChunks(false)
          return
        }

        setTimeout(poll, 1200)
      } catch (e) {
        console.error("❌ chunk poll error:", e)
      }
    }

    poll()

    return () => {
      cancelled = true
    }
  }, [sourceId])

  /* ================= UI ================= */

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* LEFT: CHUNKS (READ-ONLY INDEX) */}
      <div
        style={{
          width: "40%",
          overflowY: "auto",
          borderRight: "1px solid #e5e7eb",
          padding: "16px",
          fontSize: "13px",
        }}
      >
        <div style={{ marginBottom: "16px" }}>
          <Link
            href={`/projects/${projectId}`}
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
            ← Back to Project
          </Link>
        </div>
        {loadingChunks && (
          <div style={{ marginBottom: "12px" }}>
            <div style={{ fontSize: "12px", marginBottom: "4px" }}>
              Indexing source…
            </div>
            <div
              style={{
                height: "6px",
                background: "#e5e7eb",
                borderRadius: "4px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: "100%",
                  background: "#2563eb",
                  transition: "width 0.4s ease",
                }}
              />
            </div>
          </div>
        )}

        {chunks.map((c) => (
          <div
            key={c.id}
            style={{
              padding: "8px",
              borderBottom: "1px solid #f3f4f6",
            }}
          >
            <strong>p.{c.page_number}</strong>
            <div>{c.text}</div>
          </div>
        ))}
      </div>

      {/* RIGHT: PDF VIEWER */}
      <div style={{ width: "60%", height: "100%" }}>
        {pdfUrl ? (
          <iframe
            ref={iframeRef}
            src={`/pdf-viewer.html?file=${encodeURIComponent(pdfUrl)}`}
            style={{ width: "100%", height: "100%", border: "none" }}
          />
        ) : (
          <div style={{ padding: "40px" }}>Loading PDF…</div>
        )}
      </div>
    </div>
  )
}
