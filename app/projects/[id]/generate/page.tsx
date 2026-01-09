"use client"

import { useEffect, useRef, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"

/* ================= TYPES ================= */

type Paragraph = {
  paragraph_index: number
  text: string
  evidence_ids: string[]
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
          throw new Error("Generation failed")
        }

        const json = await res.json()

        if (!json?.reasoning_output || !json?.evidence_index) {
          throw new Error("Invalid generation payload")
        }

        setReasoning(json.reasoning_output)
        setEvidenceIndex(json.evidence_index)
        
        // Fetch source titles for all source IDs in evidence index
        const sourceIds = new Set<string>()
        for (const meta of Object.values(json.evidence_index)) {
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
      </div>
    )
  }

  if (!reasoning) {
    return <div style={{ padding: "80px" }}>No output available.</div>
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
        <h1 style={{ fontSize: "26px", fontWeight: 700 }}>
          Generated Research Project
        </h1>

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

        {reasoning.sections.map(section => (
          <div key={section.section_index} style={{ marginBottom: "40px" }}>
            <h2 style={{ fontSize: "20px", fontWeight: 600 }}>
              {section.section_index}. {section.title}
            </h2>

            {section.paragraphs.map(p => {
              const paraKey = `${section.section_index}.${p.paragraph_index}`

              return (
                <div
                  key={paraKey}
                  style={{
                    marginBottom: "20px",
                    paddingLeft: "12px",
                    borderLeft: "3px solid #e5e7eb",
                  }}
                >
                  <p style={{ fontSize: "15px", lineHeight: 1.7 }}>
                    <strong>§{paraKey}</strong> {p.text}
                  </p>

                  <div
                    style={{
                      fontSize: "12px",
                      color: "#6b7280",
                      marginTop: "6px",
                    }}
                  >
                    Evidence: see traceability panel →
                  </div>
                </div>
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

                {p.evidence_ids.map(eid => {
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
                        <strong>Paragraph:</strong>{" "}
                        {meta.paragraph_index}
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
