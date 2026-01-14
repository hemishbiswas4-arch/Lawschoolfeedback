"use client"

import { useEffect, useRef, useState } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import Link from "next/link"

/* ================= TYPES ================= */

type Citation = {
  evidence_id: string
  usage_type: "direct" | "substantial" | "reference"
  char_start?: number
  char_end?: number
  quoted_text?: string | null
  excerpt?: string | null
}

type Paragraph = {
  paragraph_index: number
  text: string
  evidence_ids: string[]
  citations?: Citation[]
}

type Section = {
  section_index: number
  title: string
  paragraphs: Paragraph[]
}

type EvidenceMeta = {
  source_id: string
  page_number: number
  paragraph_index: number
  excerpt: string
}

type ReasoningOutput = {
  sections: Section[]
}

/* ================= COMPONENT ================= */

export default function GenerateProjectPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const queryText = searchParams.get("query")
  const approachParam = searchParams.get("approach")
  const wordLimitParam = searchParams.get("word_limit")

  const hasRequestedRef = useRef(false)

  const [loading, setLoading] = useState(true)
  const [loadedFromCache, setLoadedFromCache] = useState(false)
  const [reasoning, setReasoning] = useState<ReasoningOutput | null>(null)
  const [evidenceIndex, setEvidenceIndex] = useState<
    Record<string, EvidenceMeta>
  >({})
  const [sourceTitles, setSourceTitles] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [selectedApproach, setSelectedApproach] = useState<any>(null)
  const [copySuccess, setCopySuccess] = useState(false)
  const [citationQualityScore, setCitationQualityScore] = useState<number | null>(null)
  const [coverageAnalysis, setCoverageAnalysis] = useState<any>(null)
  const [copyWithCitations, setCopyWithCitations] = useState(false)
  const [currentUser, setCurrentUser] = useState<any>(null)

  // Cache key for generation results
  const generationCacheKey = projectId && queryText ?
    `generation_${projectId}_${queryText.slice(0, 50).replace(/[^a-zA-Z0-9]/g, '_')}_${approachParam ? approachParam.slice(0, 50).replace(/[^a-zA-Z0-9]/g, '_') : 'default'}` : null

  useEffect(() => {
    const initialize = async () => {
      // Check authentication first
      const { data: sessionData } = await supabase.auth.getSession()
      const user = sessionData.session?.user
      if (!user) {
        router.replace("/login")
        return
      }
      setCurrentUser(user)

      if (!projectId || !queryText) {
        setError("Missing project or query")
        setLoading(false)
        return
      }

      // Parse approach if provided
      if (approachParam) {
        try {
          const approach = JSON.parse(approachParam)
          setSelectedApproach(approach)
        } catch (e) {
          console.error("Failed to parse approach:", e)
        }
      }

      // Check for cached generation results first
      if (typeof window !== "undefined" && generationCacheKey) {
        const cachedGeneration = sessionStorage.getItem(generationCacheKey)
        if (cachedGeneration) {
          try {
            const parsedGeneration = JSON.parse(cachedGeneration)
            console.log(`Loaded generation from sessionStorage cache`)

            // Check if this is a back/forward navigation or refresh
            const navigationEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
            const isBackForwardOrReload = navigationEntry?.type === 'back_forward' || navigationEntry?.type === 'reload'

            if (isBackForwardOrReload) {
              console.log('Back/forward navigation or refresh detected - using cached data without API call')
              setReasoning(parsedGeneration.reasoning_output)
              setEvidenceIndex(parsedGeneration.evidence_index)
              setCitationQualityScore(parsedGeneration.citation_quality_score || null)
              setCoverageAnalysis(parsedGeneration.coverage_analysis || null)
              setLoadedFromCache(true)

              // Fetch source titles for cached data
              const sourceIds = new Set<string>()
              const evidenceIndex = parsedGeneration.evidence_index as Record<string, EvidenceMeta>
              for (const meta of Object.values(evidenceIndex)) {
                sourceIds.add(meta.source_id)
              }

              if (sourceIds.size > 0) {
                const { data: sources } = await supabase
                  .from("project_sources")
                  .select("id, title")
                  .eq("project_id", projectId)
                  .in("id", Array.from(sourceIds))

                if (sources) {
                  const titleMap: Record<string, string> = {}
                  for (const source of sources) {
                    titleMap[source.id] = source.title
                  }
                  setSourceTitles(titleMap)
                }
              }

              setError(null)
              setLoading(false)
              return
            }
          } catch (e) {
            console.error("Failed to parse cached generation:", e)
            // Remove corrupted cache
            sessionStorage.removeItem(generationCacheKey)
          }
        }
      }

      if (hasRequestedRef.current) return
      hasRequestedRef.current = true

      const generate = async () => {
      try {
        // Usage logging is handled in the API route

        const requestBody: any = {
          project_id: projectId,
          query_text: queryText,
          mode: "generate",
          approach: selectedApproach,
          user_id: user.id,
          user_email: user.email,
        }

        // Add word_limit if provided via URL param
        if (wordLimitParam) {
          const limit = parseInt(wordLimitParam, 10)
          if (!isNaN(limit) && limit > 0 && limit <= 5000) {
            requestBody.word_limit = limit
          }
        }

        const res = await fetch("/api/reasoning/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        })

        if (!res.ok) {
          const errorText = await res.text()

          // Handle specific case where generation is busy
          if (res.status === 429 && errorText.includes("Please try again in 5 minutes")) {
            throw new Error("Generation is currently busy with another request. Please try again in 5 minutes.")
          }

          throw new Error(`Generation failed: ${res.status} ${errorText}`)
        }

        const json = await res.json()

        if (!json?.reasoning_output || !json?.evidence_index) {
          throw new Error("Invalid generation payload")
        }

        setReasoning(json.reasoning_output)
        setEvidenceIndex(json.evidence_index)
        setCitationQualityScore(json.citation_quality_score || null)
        setCoverageAnalysis(json.coverage_analysis || null)
        setLoadedFromCache(false)

        // Cache the generation results in sessionStorage
        if (typeof window !== "undefined" && generationCacheKey) {
          try {
            sessionStorage.setItem(generationCacheKey, JSON.stringify(json))
            console.log(`Cached generation results in sessionStorage`)
          } catch (e) {
            console.warn("Failed to cache generation results:", e)
          }
        }
        
        // Fetch source titles for all source IDs in evidence index
        const sourceIds = new Set<string>()
        const evidenceIndex = json.evidence_index as Record<string, EvidenceMeta>
        for (const meta of Object.values(evidenceIndex)) {
          sourceIds.add(meta.source_id)
        }
        
        if (sourceIds.size > 0) {
          const { data: sources } = await supabase
            .from("project_sources")
            .select("id, title")
            .eq("project_id", projectId)
            .in("id", Array.from(sourceIds))
          
          if (sources) {
            const titleMap: Record<string, string> = {}
            for (const source of sources) {
              titleMap[source.id] = source.title
            }
            setSourceTitles(titleMap)
          }
        }
        
        setError(null)
      } catch (err: any) {
        setError(err?.message ?? "Server unavailable")
      } finally {
        setLoading(false)
      }
      }

      generate()
    }

    initialize()
  }, [projectId, queryText, approachParam, router])

  /* ================= UI STATES ================= */

  if (loading) {
    return <div style={{ padding: "80px" }}>Generating project…</div>
  }

  if (error && !reasoning) {
    const isBusyError = error.includes("Generation is currently busy") || error.includes("Please try again in 5 minutes")

    return (
      <div style={{ padding: "80px", color: "#b91c1c" }}>
        <h2>{isBusyError ? "Generation In Progress" : "Unable to Generate Project"}</h2>
        <p style={{ fontSize: "16px", marginBottom: "16px" }}>{error}</p>
        {isBusyError && (
          <div style={{
            background: "#fef3c7",
            border: "1px solid #f59e0b",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "24px",
            color: "#92400e"
          }}>
            <strong>💡 Tip:</strong> Generation can take several minutes. You can work on other projects in the meantime or check back later.
          </div>
        )}
        <div style={{ marginTop: "20px" }}>
          <a
            href={`/projects/${projectId}/synthesize?query=${encodeURIComponent(queryText || "")}`}
            style={{
              display: "inline-block",
              padding: "10px 18px",
              borderRadius: "8px",
              background: "#111",
              color: "#fff",
              fontSize: "14px",
              fontWeight: 500,
              textDecoration: "none",
              marginRight: "12px",
            }}
          >
            Back to Synthesis
          </a>
          <a
            href={`/projects/${projectId}/query?query=${encodeURIComponent(queryText || "")}`}
            style={{
              display: "inline-block",
              padding: "10px 18px",
              borderRadius: "8px",
              border: "1px solid #d1d5db",
              background: "#fff",
              color: "#374151",
              fontSize: "14px",
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Back to Query
          </a>
        </div>
      </div>
    )
  }

  if (!reasoning) {
    return <div style={{ padding: "80px" }}>No output available.</div>
  }

  /* ================= COPY FUNCTIONS ================= */

  const copyText = async (includeCitations: boolean = false) => {
    if (!reasoning) return

    const text = reasoning.sections
      .map(section => {
        const sectionTitle = section.title
        const paragraphs = section.paragraphs
          .map(p => p.text.trim())
          .join("\n\n")
        return `${sectionTitle}\n\n${paragraphs}`
      })
      .join("\n\n")

    try {
      await navigator.clipboard.writeText(text)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
      // Fallback: select text in a textarea
      const textarea = document.createElement("textarea")
      textarea.value = text
      textarea.style.position = "fixed"
      textarea.style.opacity = "0"
      document.body.appendChild(textarea)
      textarea.select()
      try {
        document.execCommand("copy")
        setCopySuccess(true)
        setTimeout(() => setCopySuccess(false), 2000)
      } catch (e) {
        console.error("Fallback copy failed:", e)
      }
      document.body.removeChild(textarea)
    }
  }

  /* ================= MAIN RENDER ================= */

  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb" }}>
      {/* ========== HEADER (FULL WIDTH) ========== */}
      <div style={{
        background: "#ffffff",
        borderBottom: "1px solid #e5e7eb",
        padding: "20px 60px",
        position: "sticky",
        top: 0,
        zIndex: 10,
        boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1)"
      }}>
        <div style={{
          maxWidth: "1400px",
          margin: "0 auto",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, margin: 0 }}>
              Generated Research Project
            </h1>
            <p style={{ fontSize: "14px", color: "#6b7280", margin: "4px 0 0 0" }}>
              Query: <em>{queryText}</em>
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <Link
              href={`/projects/${projectId}/synthesize?query=${encodeURIComponent(queryText || "")}`}
              style={{
                padding: "8px 12px",
                borderRadius: "6px",
                background: "#ffffff",
                color: "#374151",
                fontSize: "12px",
                fontWeight: 500,
                textDecoration: "none",
                border: "1px solid #e5e7eb",
                display: "flex",
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
              ← Back to Synthesis
            </Link>
            <button
              onClick={() => copyText(false)}
              style={{
                padding: "8px 16px",
                background: copySuccess && !copyWithCitations ? "#10b981" : "#6b7280",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
                transition: "background 0.2s",
              }}
            >
              {copySuccess && !copyWithCitations ? "✓ Copied!" : "Copy Text"}
            </button>
          </div>
        </div>

        {/* Status messages in header */}
        <div style={{ maxWidth: "1400px", margin: "16px auto 0 auto" }}>
          {loadedFromCache && (
            <div style={{
              display: "inline-block",
              padding: "6px 10px",
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              borderRadius: "4px",
              marginRight: "12px",
              fontSize: "12px",
              color: "#166534"
            }}>
              ✓ Cached analysis
            </div>
          )}

          {selectedApproach?.argumentation_line && (
            <div style={{
              display: "inline-block",
              padding: "6px 10px",
              background: "#f0f9ff",
              border: "1px solid #bae6fd",
              borderRadius: "4px",
              marginRight: "12px",
              fontSize: "12px",
            }}>
              <strong>{selectedApproach.argumentation_line.title}</strong>
              {selectedApproach.tone && (
                <span style={{ marginLeft: "8px", color: "#6b7280" }}>
                  · {selectedApproach.tone}
                </span>
              )}
              {selectedApproach.structure_type && (
                <span style={{ marginLeft: "8px", color: "#6b7280" }}>
                  · {selectedApproach.structure_type}
                </span>
              )}
            </div>
          )}

          {citationQualityScore !== null && (
            <div style={{
              display: "inline-block",
              padding: "6px 10px",
              background: citationQualityScore >= 80 ? "#f0fdf4" : citationQualityScore >= 60 ? "#fefce8" : "#fef2f2",
              border: `1px solid ${citationQualityScore >= 80 ? "#bbf7d0" : citationQualityScore >= 60 ? "#fde047" : "#fecaca"}`,
              borderRadius: "4px",
              fontSize: "12px",
            }}>
              <strong>Citation Score:</strong>{" "}
              <span style={{
                fontWeight: "bold",
                color: citationQualityScore >= 80 ? "#16a34a" : citationQualityScore >= 60 ? "#ca8a04" : "#dc2626"
              }}>
                {citationQualityScore}/100
              </span>
              {coverageAnalysis && (
                <span style={{ marginLeft: "8px", color: "#6b7280" }}>
                  • {coverageAnalysis.primary_law_coverage || "N/A"} coverage
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ========== MAIN CONTENT GRID ========== */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0",
          maxWidth: "1400px",
          margin: "0 auto",
          minHeight: "calc(100vh - 120px)", // Account for header height
        }}
      >
        {/* ========== LEFT: PROJECT CONTENT ========== */}
        <div style={{
          padding: "40px",
          background: "#ffffff",
          borderRight: "1px solid #e5e7eb",
          overflowY: "auto",
          maxHeight: "calc(100vh - 120px)",
        }}>
          {reasoning.sections.map(section => (
            <div key={section.section_index} style={{ marginBottom: "40px" }}>
              <h2 style={{
                fontSize: "20px",
                fontWeight: 600,
                marginBottom: "16px",
                color: "#111",
                borderBottom: "2px solid #e5e7eb",
                paddingBottom: "8px"
              }}>
                {section.title}
              </h2>

              {section.paragraphs.map(p => {
                const paraKey = `${section.section_index}.${p.paragraph_index}`

                return (
                  <div
                    key={paraKey}
                    style={{
                      marginBottom: "24px",
                      paddingLeft: "16px",
                      borderLeft: "3px solid #e5e7eb",
                      position: "relative"
                    }}
                  >
                    <div style={{
                      position: "absolute",
                      left: "-20px",
                      top: "0",
                      background: "#6b7280",
                      color: "#fff",
                      fontSize: "10px",
                      fontWeight: 600,
                      padding: "2px 6px",
                      borderRadius: "10px",
                      border: "2px solid #ffffff"
                    }}>
                      §{paraKey}
                    </div>
                    <p style={{
                      fontSize: "15px",
                      lineHeight: 1.7,
                      margin: "0",
                      color: "#374151",
                      paddingTop: "4px"
                    }}>
                      {p.text}
                    </p>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* ========== RIGHT: TRACEABILITY ========== */}
        <div style={{
          padding: "40px",
          background: "#f8fafc",
          overflowY: "auto",
          maxHeight: "calc(100vh - 120px)",
        }}>
          <h2 style={{
            fontSize: "18px",
            fontWeight: 600,
            marginBottom: "24px",
            color: "#111"
          }}>
            Source Citations
          </h2>

          {reasoning.sections.map(section =>
            section.paragraphs.map(p => {
              const paraKey = `${section.section_index}.${p.paragraph_index}`

              return (
                <div
                  key={`trace-${paraKey}`}
                  style={{
                    marginBottom: "32px",
                    padding: "16px",
                    background: "#ffffff",
                    borderRadius: "8px",
                    border: "1px solid #e5e7eb",
                    boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1)"
                  }}
                >
                  <div style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    marginBottom: "12px",
                    color: "#111",
                    borderBottom: "1px solid #f3f4f6",
                    paddingBottom: "8px"
                  }}>
                    §{paraKey} - {section.title}
                  </div>

                  {p.citations && p.citations.length > 0
                    ? p.citations.map((citation, idx) => {
                        const meta = evidenceIndex[citation.evidence_id]
                        if (!meta) return null

                        const sourceTitle = sourceTitles[meta.source_id] || meta.source_id
                        const usageTypeColors: Record<string, string> = {
                          direct: "#dc2626", // red for direct quotes
                          substantial: "#ea580c", // orange for substantial use
                          reference: "#6b7280", // gray for general reference
                        }
                        const usageTypeLabels: Record<string, string> = {
                          direct: "Direct Quote",
                          substantial: "Substantial Use",
                          reference: "Reference",
                        }

                        return (
                          <div
                            key={`${paraKey}-citation-${idx}`}
                            style={{
                              fontSize: "12px",
                              marginBottom: idx < p.citations!.length - 1 ? "12px" : "0",
                              padding: "12px",
                              background: "#f9fafb",
                              borderRadius: "6px",
                              borderLeft: `3px solid ${usageTypeColors[citation.usage_type] || "#6b7280"}`,
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                              <span
                                style={{
                                  fontSize: "10px",
                                  fontWeight: 600,
                                  color: usageTypeColors[citation.usage_type] || "#6b7280",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.5px",
                                  background: `${usageTypeColors[citation.usage_type] || "#6b7280"}15`,
                                  padding: "2px 6px",
                                  borderRadius: "3px"
                                }}
                              >
                                {usageTypeLabels[citation.usage_type] || citation.usage_type}
                              </span>
                            </div>
                            <div style={{ marginBottom: "6px", fontWeight: 500 }}>
                              {sourceTitle}
                            </div>
                            <div style={{ marginBottom: "6px", color: "#6b7280" }}>
                              Page {meta.page_number}, Paragraph {meta.paragraph_index}
                              {citation.char_start !== undefined && citation.char_end !== undefined && (
                                <span style={{ marginLeft: "8px" }}>
                                  • Chars {citation.char_start}-{citation.char_end}
                                </span>
                              )}
                            </div>
                            {citation.usage_type === "direct" && citation.quoted_text && (
                              <div style={{
                                marginTop: "8px",
                                padding: "10px",
                                background: "#fff",
                                border: "1px solid #e5e7eb",
                                borderRadius: "4px",
                                fontFamily: "monospace",
                                fontSize: "11px",
                                color: "#1f2937",
                              }}>
                                <div style={{ fontWeight: 600, marginBottom: "4px", color: "#dc2626", fontSize: "10px" }}>
                                  DIRECT QUOTE:
                                </div>
                                "{citation.quoted_text}"
                              </div>
                            )}
                            {citation.usage_type === "substantial" && citation.excerpt && (
                              <div style={{
                                marginTop: "8px",
                                padding: "10px",
                                background: "#fff",
                                border: "1px solid #e5e7eb",
                                borderRadius: "4px",
                                fontSize: "11px",
                                color: "#1f2937",
                              }}>
                                <div style={{ fontWeight: 600, marginBottom: "4px", color: "#ea580c", fontSize: "10px" }}>
                                  SUBSTANTIAL USE:
                                </div>
                                {citation.excerpt}
                              </div>
                            )}
                            {citation.usage_type === "reference" && (
                              <div style={{
                                marginTop: "8px",
                                fontStyle: "italic",
                                color: "#6b7280",
                                fontSize: "11px",
                                padding: "8px",
                                background: "#f3f4f6",
                                borderRadius: "4px"
                              }}>
                                "{meta.excerpt}…"
                              </div>
                            )}
                          </div>
                        )
                      })
                    : p.evidence_ids.map(eid => {
                        const meta = evidenceIndex[eid]
                        if (!meta) return null

                        const sourceTitle = sourceTitles[meta.source_id] || meta.source_id

                        return (
                          <div
                            key={`${paraKey}-${eid}`}
                            style={{
                              fontSize: "12px",
                              marginBottom: "8px",
                              padding: "10px",
                              background: "#f9fafb",
                              borderRadius: "6px",
                              border: "1px solid #e5e7eb"
                            }}
                          >
                            <div style={{ marginBottom: "4px", fontWeight: 500 }}>
                              {sourceTitle}
                            </div>
                            <div style={{ marginBottom: "4px", color: "#6b7280" }}>
                              Page {meta.page_number}, Paragraph {meta.paragraph_index}
                            </div>
                            <div style={{
                              fontStyle: "italic",
                              color: "#6b7280",
                              fontSize: "11px"
                            }}>
                              "{meta.excerpt}…"
                            </div>
                          </div>
                        )
                      })}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
