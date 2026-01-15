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

  // Cache key for this project's query
  const queryCacheKey = projectId ? `query_${projectId}` : null

  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [retrievedChunks, setRetrievedChunks] = useState<RetrievedChunk[]>([])
  const [sourceTitles, setSourceTitles] = useState<Record<string, string>>({})
  const [loadedFromCache, setLoadedFromCache] = useState(false)
  const [chunksLoadedFromCache, setChunksLoadedFromCache] = useState(false)

  /* ---------- load cached query on mount ---------- */

  useEffect(() => {
    if (typeof window !== "undefined" && queryCacheKey) {
      const cachedQuery = localStorage.getItem(queryCacheKey)
      if (cachedQuery) {
        setQuery(cachedQuery)
        setLoadedFromCache(true)
      }
    }
  }, [queryCacheKey])

  /* ---------- save query to cache when it changes ---------- */

  useEffect(() => {
    if (typeof window !== "undefined" && queryCacheKey && query) {
      localStorage.setItem(queryCacheKey, query)
    }
  }, [query, queryCacheKey])

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

  /* ---------- load cached chunks on mount ---------- */

  useEffect(() => {
    if (typeof window !== "undefined" && projectId) {
      const cachedChunks = sessionStorage.getItem(`retrieved_chunks_${projectId}`)
      if (cachedChunks) {
        try {
          const parsedChunks = JSON.parse(cachedChunks) as RetrievedChunk[]
          setRetrievedChunks(parsedChunks)
          setChunksLoadedFromCache(true)
          console.log(`Loaded ${parsedChunks.length} chunks from sessionStorage`)
        } catch (e) {
          console.error("Failed to parse cached chunks:", e)
          // Clear corrupted cache
          sessionStorage.removeItem(`retrieved_chunks_${projectId}`)
        }
      }
    }
  }, [projectId])

  /* ---------- retrieval ---------- */

  const runRetrieval = async () => {
    if (!query.trim()) return

    setLoading(true)
    setRetrievedChunks([])

    // Get user for authentication
    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData.session?.user
    if (!user) {
      alert("Authentication required. Please log in and try again.")
      setLoading(false)
      return
    }

    const res = await fetch("/api/reasoning/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        query_text: query.trim(),
        mode: "retrieve",
        user_id: user.id,
        user_email: user.email,
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
    setChunksLoadedFromCache(false) // Reset cache indicator for fresh results

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
    <div style={{
      minHeight: "100vh",
      background: "#f9fafb",
      fontFamily: "system-ui, -apple-system, sans-serif",
      padding: "40px 20px"
    }}>
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        {/* HEADER */}
        <div style={{
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          borderRadius: "16px",
          padding: "32px",
          marginBottom: "32px",
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)"
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <h1 style={{ fontSize: "32px", fontWeight: 700, color: "#111", margin: 0 }}>
              Research Query
            </h1>
            <Link
              href={`/projects/${projectId}`}
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
              ← Back to Project
            </Link>
          </div>
          <p style={{ fontSize: "15px", color: "#6b7280", marginBottom: "24px", lineHeight: 1.5 }}>
            Query your uploaded legal sources to retrieve relevant evidence for your research.
          </p>

          {/* PROMPT GUIDANCE */}
          <div style={{
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px"
          }}>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#111", marginBottom: "16px" }}>
              Crafting Your Paper Prompt
            </h2>
            <div style={{ display: "grid", gap: "16px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <h3 style={{ fontSize: "15px", fontWeight: 600, color: "#374151", margin: 0 }}>
                  Structured Prompts for Better Results
                </h3>
                <p style={{ fontSize: "14px", color: "#6b7280", margin: 0, lineHeight: 1.5 }}>
                  Instead of simple queries, provide detailed instructions on how you want your paper structured.
                  Include the paper's organization, content focus areas, and any specific requirements.
                  Keep prompts under 2000 characters for optimal processing.
                </p>
              </div>


              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <h3 style={{ fontSize: "15px", fontWeight: 600, color: "#374151", margin: 0 }}>
                  Paper Structure & Focus
                </h3>
                <p style={{ fontSize: "14px", color: "#6b7280", margin: 0, lineHeight: 1.5 }}>
                  Describe the desired paper structure (introduction, body sections, conclusion) and areas to emphasize.
                  Include word count targets, tone (formal, analytical), and any specific legal frameworks to apply.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <h3 style={{ fontSize: "15px", fontWeight: 600, color: "#374151", margin: 0 }}>
                  Example Prompts
                </h3>
                <div style={{ fontSize: "13px", color: "#6b7280", lineHeight: 1.6 }}>
                  <div style={{ marginBottom: "12px" }}>
                    <strong>Structured:</strong> "Write a 1500-word legal memorandum analyzing strict liability under tort law. Structure with introduction, elements of strict liability, case law analysis, and conclusion. Focus on recent Supreme Court decisions and emphasize policy justifications for strict liability."
                  </div>
                  <div style={{ marginBottom: "12px" }}>
                    <strong>Structured:</strong> "Create a 2000-word research paper on contract formation requirements. Include: executive summary, background section, analysis of offer/acceptance/mutual assent, remedies for breach, and conclusion. Integrate case law examples throughout, focus on UCC Article 2."
                  </div>
                  <div>
                    <strong>Simple option:</strong> "Write about contract law" (for when you're feeling lazy)
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {loadedFromCache && (
          <div style={{
            padding: "8px 12px",
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "6px",
            fontSize: "12px",
            color: "#166534",
            marginBottom: "12px"
          }}>
            ✓ Query text restored from previous session
          </div>
        )}

        {chunksLoadedFromCache && (
          <div style={{
            padding: "8px 12px",
            background: "#f0f9ff",
            border: "1px solid #bae6fd",
            borderRadius: "6px",
            fontSize: "12px",
            color: "#0c4a6e",
            marginBottom: "24px"
          }}>
            ✓ Retrieved evidence restored from previous session
          </div>
        )}

        {/* QUERY INPUT CARD */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "16px",
            padding: "32px",
            marginBottom: "32px",
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)"
          }}
        >
          <div style={{ marginBottom: "24px" }}>
            <label
              style={{
                display: "block",
                fontSize: "16px",
                fontWeight: 600,
                color: "#374151",
                marginBottom: "12px",
              }}
            >
              Paper Prompt
            </label>
            <textarea
              value={query}
              onChange={e => setQuery(e.target.value)}
              rows={6}
              placeholder="e.g., Write a 1500-word legal memorandum on strict liability in tort law. Structure with introduction, elements analysis, case law review, and conclusion."
              style={{
                width: "100%",
                padding: "16px",
                borderRadius: "8px",
                border: "1px solid #d1d5db",
                fontSize: "15px",
                fontFamily: "inherit",
                resize: "vertical",
                lineHeight: 1.5,
                transition: "border-color 0.2s",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "#6b7280"
                e.target.style.outline = "none"
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "#d1d5db"
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
            <button
              onClick={runRetrieval}
              disabled={loading || !query.trim()}
              style={{
                padding: "12px 24px",
                borderRadius: "8px",
                background: loading || !query.trim() ? "#9ca3af" : "#111",
                color: "#fff",
                fontSize: "15px",
                fontWeight: 600,
                border: "none",
                cursor: loading || !query.trim() ? "not-allowed" : "pointer",
                transition: "background 0.2s",
              }}
            >
              {loading ? "Retrieving…" : "Retrieve Evidence"}
            </button>

            {totalChunks > 0 && (
              <div style={{
                fontSize: "14px",
                color: "#6b7280",
                padding: "8px 12px",
                background: "#f9fafb",
                borderRadius: "6px",
                border: "1px solid #e5e7eb"
              }}>
                Found <strong style={{ color: "#111" }}>{totalChunks}</strong> relevant chunk{totalChunks !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>

        {/* ================= RESULTS ================= */}

        {grouped.length > 0 && (
          <div>
            {/* RESULTS HEADER */}
            <div style={{
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: "16px",
              padding: "24px",
              marginBottom: "24px",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)"
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
                <div>
                  <h2 style={{ fontSize: "20px", fontWeight: 600, color: "#111", margin: 0 }}>
                    Retrieved Evidence
                  </h2>
                  <p style={{ fontSize: "14px", color: "#6b7280", margin: "4px 0 0 0" }}>
                    Review the most relevant passages from your sources
                  </p>
                </div>
                <Link
                  href={{
                    pathname: `/projects/${projectId}/synthesize`,
                    query: { query },
                  }}
                  style={{
                    padding: "12px 24px",
                    borderRadius: "8px",
                    background: "#111",
                    color: "#fff",
                    fontSize: "15px",
                    fontWeight: 600,
                    textDecoration: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    transition: "background 0.2s",
                    whiteSpace: "nowrap"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#374151"
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#111"
                  }}
                >
                  Continue to Analysis →
                </Link>
              </div>
            </div>

            {/* SOURCE GROUPS */}
            {grouped.map(([sourceId, chunks]) => (
              <div
                key={sourceId}
                style={{
                  background: "#ffffff",
                  borderRadius: "16px",
                  border: "1px solid #e5e7eb",
                  overflow: "hidden",
                  marginBottom: "24px",
                  boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)"
                }}
              >
                <div
                  style={{
                    background: "#f9fafb",
                    padding: "20px 24px",
                    borderBottom: "1px solid #e5e7eb",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#111", margin: 0 }}>
                    {sourceTitles[sourceId] ?? sourceId}
                  </h3>
                  <span style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "#6b7280",
                    padding: "4px 8px",
                    background: "#ffffff",
                    borderRadius: "4px",
                    border: "1px solid #e5e7eb"
                  }}>
                    {chunks.length} chunk{chunks.length !== 1 ? 's' : ''}
                  </span>
                </div>

                <div>
                  {chunks.map((chunk, index) => (
                    <div
                      key={chunk.id}
                      style={{
                        padding: "24px",
                        borderBottom:
                          index < chunks.length - 1
                            ? "1px solid #f3f4f6"
                            : "none",
                        transition: "background 0.2s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "#f9fafb"
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "#ffffff"
                      }}
                    >
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        marginBottom: "16px",
                        flexWrap: "wrap"
                      }}>
                        <span style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "#111",
                          padding: "2px 8px",
                          background: "#f3f4f6",
                          borderRadius: "4px",
                          border: "1px solid #e5e7eb"
                        }}>
                          #{index + 1}
                        </span>

                        {typeof chunk.similarity === "number" && (
                          <span style={{
                            fontSize: "12px",
                            color: "#6b7280",
                            padding: "2px 8px",
                            background: "#f9fafb",
                            borderRadius: "4px",
                            border: "1px solid #e5e7eb"
                          }}>
                            Relevance: {chunk.similarity.toFixed(3)}
                          </span>
                        )}

                        {chunk.page_number !== null && (
                          <span style={{
                            fontSize: "12px",
                            color: "#6b7280",
                            padding: "2px 8px",
                            background: "#f9fafb",
                            borderRadius: "4px",
                            border: "1px solid #e5e7eb"
                          }}>
                            Page {chunk.page_number}
                          </span>
                        )}
                      </div>

                      <div style={{
                        fontSize: "15px",
                        lineHeight: 1.6,
                        color: "#374151"
                      }}>
                        {chunk.text}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* CONTINUE SECTION */}
            <div style={{
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: "16px",
              padding: "32px",
              marginTop: "32px",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)"
            }}>
              <div style={{ textAlign: "center" }}>
                <h3 style={{ fontSize: "18px", fontWeight: 600, color: "#111", marginBottom: "8px" }}>
                  Analysis Phase
                </h3>
                <p style={{ fontSize: "15px", color: "#6b7280", marginBottom: "24px", lineHeight: 1.5 }}>
                  Review the retrieved evidence above, then proceed to develop your legal analysis and argumentation strategy.
                </p>
                <Link
                  href={{
                    pathname: `/projects/${projectId}/synthesize`,
                    query: { query },
                  }}
                  style={{
                    padding: "14px 32px",
                    borderRadius: "8px",
                    background: "#111",
                    color: "#fff",
                    fontSize: "16px",
                    fontWeight: 600,
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    transition: "background 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#374151"
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#111"
                  }}
                >
                  Continue to Analysis →
                </Link>
              </div>
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
