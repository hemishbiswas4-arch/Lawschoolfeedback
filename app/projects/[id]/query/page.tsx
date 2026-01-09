"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"

/* ================= TYPES ================= */

type RetrievedChunk = {
  id: string
  source_id: string | null
  text: string
  page_number: number | null
  paragraph_index: number | null
  chunk_index: number | null
  similarity: number | null
}

type SourceMeta = {
  id: string
  title: string
}

/* ================= HELPERS ================= */

function groupBySource(chunks: RetrievedChunk[]) {
  const map = new Map<string, RetrievedChunk[]>()

  for (const chunk of chunks) {
    const source = chunk.source_id ?? "unknown"
    if (!map.has(source)) map.set(source, [])
    map.get(source)!.push(chunk)
  }

  return Array.from(map.entries())
}

/* ================= COMPONENT ================= */

export default function QueryPage() {
  const { id: projectId } = useParams<{ id: string }>()

  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [retrievedChunks, setRetrievedChunks] = useState<RetrievedChunk[]>([])
  const [sourceTitles, setSourceTitles] = useState<Record<string, string>>({})

  /* ---------- load source titles once ---------- */

  useEffect(() => {
    if (!projectId) return

    const loadSources = async () => {
      const { data } = await supabase
        .from("project_sources")
        .select("id, title")
        .eq("project_id", projectId)

      if (!data) return

      const map: Record<string, string> = {}
      for (const s of data as SourceMeta[]) {
        map[s.id] = s.title
      }
      setSourceTitles(map)
    }

    loadSources()
  }, [projectId])

  /* ---------- retrieval ---------- */

  const runRetrieval = async () => {
    if (!query.trim()) return

    setLoading(true)
    setRetrievedChunks([])

    const res = await fetch("/api/reasoning/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        query_text: query.trim(),
        mode: "retrieve",
      }),
    })

    setLoading(false)

    if (!res.ok) {
      alert("Retrieval failed")
      return
    }

    const json = await res.json()

    const normalised: RetrievedChunk[] = (json.retrieved_chunks ?? []).map(
      (c: any) => ({
        id: c.id,
        source_id: c.source_id ?? null,
        text: c.text,
        page_number: c.page_number ?? null,
        paragraph_index: c.paragraph_index ?? null,
        chunk_index: c.chunk_index ?? null,
        similarity: typeof c.similarity === "number" ? c.similarity : null,
      })
    )

    setRetrievedChunks(normalised)

    // Store chunks in sessionStorage for synthesize page
    if (typeof window !== "undefined" && projectId) {
      try {
        sessionStorage.setItem(
          `retrieved_chunks_${projectId}`,
          JSON.stringify(normalised)
        )
        console.log(`Stored ${normalised.length} chunks in sessionStorage`)
      } catch (e) {
        console.error("Failed to store chunks in sessionStorage:", e)
      }
    }
  }

  const grouped = groupBySource(retrievedChunks)
  const totalChunks = retrievedChunks.length

  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb", padding: "40px 20px" }}>
      <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
        {/* HEADER */}
        <div style={{ marginBottom: "32px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#111" }}>
              Research Query
            </h1>
            <Link
              href={`/projects/${projectId}`}
              style={{
                padding: "8px 12px",
                borderRadius: "6px",
                background: "#fff",
                color: "#374151",
                fontSize: "13px",
                fontWeight: 500,
                textDecoration: "none",
                border: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              Back to Project
            </Link>
          </div>
          <p style={{ fontSize: "14px", color: "#6b7280" }}>
            Enter your research question to retrieve relevant evidence from uploaded sources.
          </p>
        </div>

        {/* QUERY INPUT CARD */}
        <div
          style={{
            background: "#fff",
            borderRadius: "12px",
            border: "1px solid #e5e7eb",
            padding: "24px",
            marginBottom: "24px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 600,
              color: "#374151",
              marginBottom: "8px",
            }}
          >
            Research Question
          </label>
          <textarea
            value={query}
            onChange={e => setQuery(e.target.value)}
            rows={5}
            placeholder="e.g., How have digital platform markets changed relevant market definition in competition law?"
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: "8px",
              border: "1px solid #d1d5db",
              fontSize: "14px",
              fontFamily: "inherit",
              resize: "vertical",
              marginBottom: "16px",
              transition: "border-color 0.2s",
            }}
            onFocus={(e) => {
              e.target.style.borderColor = "#2563eb"
              e.target.style.outline = "none"
            }}
            onBlur={(e) => {
              e.target.style.borderColor = "#d1d5db"
            }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              onClick={runRetrieval}
              disabled={loading || !query.trim()}
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
                background: loading || !query.trim() ? "#9ca3af" : "#111",
                color: "#fff",
                fontSize: "14px",
                fontWeight: 600,
                border: "none",
                cursor: loading || !query.trim() ? "not-allowed" : "pointer",
                transition: "background 0.2s",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {loading ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
                    <circle cx="12" cy="12" r="10" opacity="0.25"/>
                    <path d="M12 2a10 10 0 0 1 10 10" opacity="0.75"/>
                  </svg>
                  Retrieving…
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"/>
                    <path d="m21 21-4.35-4.35"/>
                  </svg>
                  Retrieve Evidence
                </>
              )}
            </button>

            {totalChunks > 0 && (
              <div style={{ fontSize: "13px", color: "#6b7280" }}>
                Found <strong style={{ color: "#111" }}>{totalChunks}</strong> relevant chunk{totalChunks !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>

        {/* ================= RESULTS ================= */}

        {grouped.length > 0 && (
          <div>
            {/* RESULTS HEADER */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "20px",
              }}
            >
              <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#111" }}>
                Retrieved Evidence
              </h2>
              <Link
                href={{
                  pathname: `/projects/${projectId}/synthesize`,
                  query: {
                    query,
                  },
                }}
                style={{
                  padding: "10px 18px",
                  borderRadius: "8px",
                  background: "#111",
                  color: "#fff",
                  fontSize: "14px",
                  fontWeight: 600,
                  textDecoration: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  transition: "background 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#1f2937"
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#111"
                }}
              >
                Continue to Argumentation Strategy
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </Link>
            </div>

            {/* SOURCE GROUPS */}
            {grouped.map(([sourceId, chunks]) => (
              <div
                key={sourceId}
                style={{
                  background: "#fff",
                  borderRadius: "12px",
                  border: "1px solid #e5e7eb",
                  overflow: "hidden",
                  marginBottom: "20px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                }}
              >
                <div
                  style={{
                    background: "linear-gradient(to right, #f8fafc, #f1f5f9)",
                    padding: "14px 18px",
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "#111",
                    borderBottom: "1px solid #e5e7eb",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span>{sourceTitles[sourceId] ?? sourceId}</span>
                  <span style={{ fontSize: "12px", fontWeight: 500, color: "#6b7280" }}>
                    {chunks.length} chunk{chunks.length !== 1 ? 's' : ''}
                  </span>
                </div>

                <div>
                  {chunks.map((chunk, index) => (
                    <div
                      key={chunk.id}
                      style={{
                        padding: "18px",
                        borderBottom:
                          index < chunks.length - 1
                            ? "1px solid #f1f5f9"
                            : "none",
                        transition: "background 0.2s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "#f9fafb"
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "#fff"
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          marginBottom: "10px",
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            color: "#fff",
                            background: "#6366f1",
                            padding: "4px 8px",
                            borderRadius: "4px",
                          }}
                        >
                          Rank {index + 1}
                        </span>
                        {typeof chunk.similarity === "number" && (
                          <span
                            style={{
                              fontSize: "11px",
                              color: "#6b7280",
                              background: "#f3f4f6",
                              padding: "4px 8px",
                              borderRadius: "4px",
                            }}
                          >
                            Score: {chunk.similarity.toFixed(3)}
                          </span>
                        )}
                        {chunk.page_number !== null && (
                          <span
                            style={{
                              fontSize: "11px",
                              color: "#6b7280",
                              background: "#f3f4f6",
                              padding: "4px 8px",
                              borderRadius: "4px",
                            }}
                          >
                            Page {chunk.page_number}
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          fontSize: "14px",
                          lineHeight: 1.7,
                          color: "#374151",
                        }}
                      >
                        {chunk.text}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* QUICK ACTION BAR */}
            <div
              style={{
                background: "#fff",
                borderRadius: "12px",
                border: "1px solid #e5e7eb",
                padding: "20px",
                marginTop: "24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              }}
            >
              <div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "#111", marginBottom: "4px" }}>
                  Ready to proceed?
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280" }}>
                  Review the evidence above, then continue to select your argumentation approach.
                </div>
              </div>
              <Link
                href={{
                  pathname: `/projects/${projectId}/synthesize`,
                  query: {
                    query,
                  },
                }}
                style={{
                  padding: "12px 24px",
                  borderRadius: "8px",
                  background: "#111",
                  color: "#fff",
                  fontSize: "14px",
                  fontWeight: 600,
                  textDecoration: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  whiteSpace: "nowrap",
                  transition: "background 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#1f2937"
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#111"
                }}
              >
                Continue to Argumentation Strategy
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </Link>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
