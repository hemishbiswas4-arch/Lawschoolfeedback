"use client"

import { useEffect, useRef, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"

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
  const queryText = searchParams.get("query")
  const approachParam = searchParams.get("approach")
  const wordLimitParam = searchParams.get("word_limit")

  const hasRequestedRef = useRef(false)

  const [loading, setLoading] = useState(true)
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

  useEffect(() => {
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

    if (hasRequestedRef.current) return
    hasRequestedRef.current = true

    const generate = async () => {
      try {
        const requestBody: any = {
          project_id: projectId,
          query_text: queryText,
          mode: "generate",
          approach: selectedApproach,
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
  }, [projectId, queryText, approachParam])

  /* ================= UI STATES ================= */

  if (loading) {
    return <div style={{ padding: "80px" }}>Generating project…</div>
  }

  if (error && !reasoning) {
    return (
      <div style={{ padding: "80px", color: "#b91c1c" }}>
        <h2>Unable to Generate Project</h2>
        <p>{error}</p>
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
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.3fr 1fr",
        gap: "40px",
        padding: "60px",
        maxWidth: "1400px",
        margin: "0 auto",
      }}
    >
      {/* ========== LEFT: PROJECT ========== */}

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
          <h1 style={{ fontSize: "26px", fontWeight: 700, margin: 0 }}>
            Generated Research Project
          </h1>
          <div style={{ display: "flex", gap: "8px" }}>
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

        <p style={{ fontSize: "14px", color: "#6b7280", marginBottom: "32px" }}>
          Query: <em>{queryText}</em>
        </p>

        {selectedApproach?.argumentation_line && (
          <div
            style={{
              padding: "12px 16px",
              background: "#f0f9ff",
              border: "1px solid #bae6fd",
              borderRadius: "8px",
              marginBottom: "24px",
              fontSize: "13px",
            }}
          >
            <strong>Selected Approach:</strong> {selectedApproach.argumentation_line.title}
            {selectedApproach.tone && (
              <span style={{ marginLeft: "12px", color: "#6b7280" }}>
                · Tone: {selectedApproach.tone}
              </span>
            )}
            {selectedApproach.structure_type && (
              <span style={{ marginLeft: "12px", color: "#6b7280" }}>
                · Structure: {selectedApproach.structure_type}
              </span>
            )}
          </div>
        )}

        {citationQualityScore !== null && (
          <div
            style={{
              padding: "12px 16px",
              background: citationQualityScore >= 80 ? "#f0fdf4" : citationQualityScore >= 60 ? "#fefce8" : "#fef2f2",
              border: `1px solid ${citationQualityScore >= 80 ? "#bbf7d0" : citationQualityScore >= 60 ? "#fde047" : "#fecaca"}`,
              borderRadius: "8px",
              marginBottom: "24px",
              fontSize: "13px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <strong>Citation Quality Score:</strong>
              <span style={{
                fontSize: "16px",
                fontWeight: "bold",
                color: citationQualityScore >= 80 ? "#16a34a" : citationQualityScore >= 60 ? "#ca8a04" : "#dc2626"
              }}>
                {citationQualityScore}/100
              </span>
            </div>
            {coverageAnalysis && (
              <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>
                Primary Law Coverage: {coverageAnalysis.primary_law_coverage || "N/A"} •
                Citations per Section: {coverageAnalysis.citation_density || "N/A"}
              </div>
            )}
          </div>
        )}

        {reasoning.sections.map(section => (
          <div key={section.section_index} style={{ marginBottom: "40px" }}>
            <h2 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "16px" }}>
              {section.title}
            </h2>

            {section.paragraphs.map(p => {
              const paraKey = `${section.section_index}.${p.paragraph_index}`

              return (
                <p
                  key={paraKey}
                  style={{
                    fontSize: "15px",
                    lineHeight: 1.7,
                    marginBottom: "20px",
                  }}
                >
                  {p.text}
                </p>
              )
            })}
          </div>
        ))}
      </div>

      {/* ========== RIGHT: TRACEABILITY ========== */}

      <div>
        <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "20px" }}>
          Traceability Panel
        </h2>

        {reasoning.sections.map(section =>
          section.paragraphs.map(p => {
            const paraKey = `${section.section_index}.${p.paragraph_index}`

            return (
              <div
                key={`trace-${paraKey}`}
                style={{
                  marginBottom: "24px",
                  paddingBottom: "16px",
                  borderBottom: "1px solid #e5e7eb",
                }}
              >
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    marginBottom: "8px",
                  }}
                >
                  §{paraKey}
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
                            marginBottom: "12px",
                            padding: "10px",
                            background: "#f9fafb",
                            borderRadius: "6px",
                            borderLeft: `3px solid ${usageTypeColors[citation.usage_type] || "#6b7280"}`,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                            <span
                              style={{
                                fontSize: "10px",
                                fontWeight: 600,
                                color: usageTypeColors[citation.usage_type] || "#6b7280",
                                textTransform: "uppercase",
                                letterSpacing: "0.5px",
                              }}
                            >
                              {usageTypeLabels[citation.usage_type] || citation.usage_type}
                            </span>
                          </div>
                          <div style={{ marginBottom: "4px" }}>
                            <strong>Source:</strong> {sourceTitle}
                          </div>
                          <div style={{ marginBottom: "4px" }}>
                            <strong>Page:</strong> {meta.page_number},{" "}
                            <strong>Paragraph:</strong> {meta.paragraph_index}
                            {citation.char_start !== undefined && citation.char_end !== undefined && (
                              <span style={{ marginLeft: "8px", color: "#6b7280" }}>
                                · Chars {citation.char_start}-{citation.char_end}
                              </span>
                            )}
                          </div>
                          {citation.usage_type === "direct" && citation.quoted_text && (
                            <div
                              style={{
                                marginTop: "6px",
                                padding: "8px",
                                background: "#fff",
                                border: "1px solid #e5e7eb",
                                borderRadius: "4px",
                                fontFamily: "monospace",
                                fontSize: "11px",
                                color: "#1f2937",
                              }}
                            >
                              <div style={{ fontWeight: 600, marginBottom: "4px", color: "#dc2626" }}>
                                Direct Quote:
                              </div>
                              "{citation.quoted_text}"
                            </div>
                          )}
                          {citation.usage_type === "substantial" && citation.excerpt && (
                            <div
                              style={{
                                marginTop: "6px",
                                padding: "8px",
                                background: "#fff",
                                border: "1px solid #e5e7eb",
                                borderRadius: "4px",
                                fontSize: "11px",
                                color: "#1f2937",
                              }}
                            >
                              <div style={{ fontWeight: 600, marginBottom: "4px", color: "#ea580c" }}>
                                Substantial Use:
                              </div>
                              {citation.excerpt}
                            </div>
                          )}
                          {citation.usage_type === "reference" && (
                            <div
                              style={{
                                marginTop: "6px",
                                fontStyle: "italic",
                                color: "#6b7280",
                                fontSize: "11px",
                              }}
                            >
                              “{meta.excerpt}…”
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
                            marginBottom: "10px",
                            color: "#374151",
                          }}
                        >
                          <div>
                            <strong>Source:</strong> {sourceTitle}
                          </div>
                          <div>
                            <strong>Page:</strong> {meta.page_number},{" "}
                            <strong>Paragraph:</strong> {meta.paragraph_index}
                          </div>
                          <div
                            style={{
                              marginTop: "4px",
                              fontStyle: "italic",
                              color: "#6b7280",
                            }}
                          >
                            “{meta.excerpt}…”
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
  )
}
