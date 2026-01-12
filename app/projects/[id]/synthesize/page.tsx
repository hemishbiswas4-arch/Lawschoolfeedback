"use client"

import { useEffect, useState, useRef } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"

/* ================= TYPES ================= */

type ArgumentationLine = {
  id: string
  title: string
  description: string
  structure: {
    sections: Array<{
      section_index: number
      title: string
      description: string
    }>
  }
  approach: string
  focus_areas: string[]
  tone: string
}

type RecommendedStructure = {
  type: string
  description: string
  sections: Array<{
    section_index: number
    title: string
    description: string
  }>
}

type PersonalizationOption = {
  value: string
  label: string
  description: string
}

type SynthesizeResponse = {
  argumentation_lines: ArgumentationLine[]
  recommended_structure: RecommendedStructure
  personalization_options: {
    tone_options: PersonalizationOption[]
    structure_options: PersonalizationOption[]
    focus_options: PersonalizationOption[]
  }
}

type SelectedApproach = {
  argumentation_line_id: string | null
  tone: string
  structure_type: string
  focus_areas: string[]
  custom_sections?: Array<{
    section_index: number
    title: string
    description: string
  }>
}

/* ================= COMPONENT ================= */

export default function SynthesizePage() {
  const { id: projectId } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()

  const queryText = searchParams.get("query")
  const retrievedChunksParam = searchParams.get("chunks") // Keep for fallback

  const [loading, setLoading] = useState(true)
  const [synthesizing, setSynthesizing] = useState(false)
  const [synthesis, setSynthesis] = useState<SynthesizeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [selectedApproach, setSelectedApproach] = useState<SelectedApproach>({
    argumentation_line_id: null,
    tone: "",
    structure_type: "",
    focus_areas: [],
  })
  const [wordLimit, setWordLimit] = useState<string>("")

  // Ref to prevent duplicate calls
  const synthesisInProgress = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  /* ================= LOAD SYNTHESIS ================= */

  useEffect(() => {
    if (!projectId || !queryText) {
      setError("Missing required parameters")
      setLoading(false)
      return
    }

    // Prevent duplicate calls
    if (synthesisInProgress.current) {
      console.log("Synthesis already in progress, skipping duplicate call")
      return
    }

    const synthesize = async () => {
      // Cancel any previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }

      synthesisInProgress.current = true
      const abortController = new AbortController()
      abortControllerRef.current = abortController

      setSynthesizing(true)
      setError(null)

      try {
        // Try to read chunks from sessionStorage first, then fall back to URL params
        let retrievedChunks: any[] = []
        
        if (typeof window !== "undefined") {
          // First try sessionStorage
          const storedChunks = sessionStorage.getItem(`retrieved_chunks_${projectId}`)
          if (storedChunks) {
            try {
              retrievedChunks = JSON.parse(storedChunks)
              console.log(`Loaded ${retrievedChunks.length} chunks from sessionStorage`)
            } catch (e) {
              console.error("Failed to parse stored chunks:", e)
            }
          }
          
          // Fallback to URL params if sessionStorage is empty (for old links)
          if ((!retrievedChunks || retrievedChunks.length === 0) && retrievedChunksParam) {
            try {
              const decoded = decodeURIComponent(retrievedChunksParam)
              retrievedChunks = JSON.parse(decoded)
              console.log(`Loaded ${retrievedChunks.length} chunks from URL params`)
              // Also save to sessionStorage for future use
              sessionStorage.setItem(`retrieved_chunks_${projectId}`, JSON.stringify(retrievedChunks))
            } catch (e) {
              console.error("Failed to parse URL chunks:", e)
            }
          }
        }

        if (!retrievedChunks || retrievedChunks.length === 0) {
          setError("No retrieved chunks found. Please go back to the query page and retrieve evidence first.")
          setSynthesizing(false)
          setLoading(false)
          return
        }

        console.log(`Proceeding with ${retrievedChunks.length} chunks for synthesis`)

        console.log("Calling synthesis API...")
        const res = await fetch("/api/reasoning/synthesize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            query_text: queryText,
            retrieved_chunks: retrievedChunks,
          }),
          signal: abortController.signal,
        })

        if (!res.ok) {
          const errorText = await res.text()
          console.error("Synthesis API error:", res.status, errorText)

          // Handle specific case where synthesis is busy
          if (res.status === 429 && errorText.includes("Please try again in 5 minutes")) {
            throw new Error("Synthesis is currently busy with another request. Please try again in 5 minutes.")
          }

          throw new Error(`Synthesis failed: ${res.status} ${errorText}`)
        }

        const data = await res.json()
        console.log("Synthesis response received:", data)
        setSynthesis(data)

        // Set defaults
        if (data.recommended_structure) {
          setSelectedApproach({
            argumentation_line_id: null,
            tone: data.personalization_options.tone_options[0]?.value || "",
            structure_type: data.recommended_structure.type,
            focus_areas: [],
          })
        }
      } catch (err: any) {
        // Don't show error if request was aborted
        if (err.name === "AbortError") {
          console.log("Synthesis request aborted")
          return
        }
        console.error("Synthesis error:", err)
        setError(err?.message ?? "Synthesis failed. Please check the console for details.")
      } finally {
        synthesisInProgress.current = false
        abortControllerRef.current = null
        setSynthesizing(false)
        setLoading(false)
      }
    }

    synthesize()

    // Cleanup function to abort request if component unmounts or dependencies change
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      synthesisInProgress.current = false
    }
  }, [projectId, queryText])

  /* ================= HANDLERS ================= */

  const handleGenerate = () => {
    if (!selectedApproach.argumentation_line_id && !selectedApproach.structure_type) {
      alert("Please select an argumentation approach or structure")
      return
    }

    const selectedLine = synthesis?.argumentation_lines.find(
      (l) => l.id === selectedApproach.argumentation_line_id
    )

    const params = new URLSearchParams({
      query: queryText || "",
      approach: JSON.stringify({
        argumentation_line: selectedLine || null,
        tone: selectedApproach.tone,
        structure_type: selectedApproach.structure_type,
        focus_areas: selectedApproach.focus_areas,
        sections: selectedLine?.structure.sections || synthesis?.recommended_structure.sections || [],
      }),
    })

    // Add word_limit if provided
    if (wordLimit.trim()) {
      const limit = parseInt(wordLimit.trim(), 10)
      if (!isNaN(limit) && limit > 0 && limit <= 5000) {
        params.set("word_limit", limit.toString())
      }
    }

    router.push(`/projects/${projectId}/generate?${params.toString()}`)
  }

  /* ================= UI STATES ================= */

  // Show loading state until synthesis is complete
  if (loading || synthesizing || !synthesis) {
    return (
      <div style={{ padding: "80px", textAlign: "center" }}>
        <div style={{ fontSize: "16px", marginBottom: "12px" }}>
          {synthesizing ? "Analyzing evidence and generating argumentation options…" : "Loading…"}
        </div>
        <div style={{ fontSize: "14px", color: "#6b7280", marginBottom: "8px" }}>
          This may take a moment
        </div>
        {error && (
          <div style={{ maxWidth: "600px", margin: "16px auto 0" }}>
            <div style={{ fontSize: "13px", color: "#b91c1c", padding: "12px", background: "#fef2f2", borderRadius: "8px", marginBottom: "12px" }}>
              {error}
            </div>
            <Link
              href={`/projects/${projectId}/query?query=${encodeURIComponent(queryText || "")}`}
              style={{
                display: "inline-block",
                padding: "10px 18px",
                borderRadius: "8px",
                background: "#111",
                color: "#fff",
                fontSize: "14px",
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Back to Query
            </Link>
          </div>
        )}
      </div>
    )
  }

  // Show error state only if we have no synthesis AND an error occurred
  if (error) {
    return (
      <div style={{ padding: "80px", color: "#b91c1c" }}>
        <h2>Unable to Synthesize Approaches</h2>
        <p>{error}</p>
        <Link
          href={`/projects/${projectId}/query?query=${encodeURIComponent(queryText || "")}`}
          style={{
            display: "inline-block",
            marginTop: "16px",
            padding: "10px 18px",
            borderRadius: "8px",
            background: "#111",
            color: "#fff",
            fontSize: "14px",
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          Back to Query
        </Link>
      </div>
    )
  }

  /* ================= MAIN RENDER ================= */

  return (
    <div style={{ padding: "60px", maxWidth: "1200px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "26px", fontWeight: 700, marginBottom: "12px" }}>
        Argumentation Strategy
      </h1>

      <p style={{ fontSize: "14px", color: "#6b7280", marginBottom: "32px" }}>
        Query: <em>{queryText}</em>
      </p>

      {/* ========== ARGUMENTATION LINES ========== */}

      <div style={{ marginBottom: "40px" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "20px" }}>
          Select Argumentation Approach
        </h2>

        <div style={{ display: "grid", gap: "16px" }}>
          {synthesis.argumentation_lines.map((line) => {
            const isSelected = selectedApproach.argumentation_line_id === line.id

            return (
              <div
                key={line.id}
                onClick={() => {
                  setSelectedApproach({
                    ...selectedApproach,
                    argumentation_line_id: line.id,
                    tone: line.tone,
                    structure_type: synthesis.recommended_structure.type,
                    focus_areas: line.focus_areas,
                  })
                }}
                style={{
                  border: `2px solid ${isSelected ? "#2563eb" : "#e5e7eb"}`,
                  borderRadius: "12px",
                  padding: "20px",
                  cursor: "pointer",
                  background: isSelected ? "#eff6ff" : "#fff",
                  transition: "all 0.2s",
                }}
              >
                <div style={{ display: "flex", alignItems: "start", gap: "12px" }}>
                  <input
                    type="radio"
                    checked={isSelected}
                    onChange={() => {
                      setSelectedApproach({
                        ...selectedApproach,
                        argumentation_line_id: line.id,
                        tone: line.tone,
                        structure_type: synthesis.recommended_structure.type,
                        focus_areas: line.focus_areas,
                      })
                    }}
                    style={{ marginTop: "4px" }}
                  />
                  <div style={{ flex: 1 }}>
                    <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>
                      {line.title}
                    </h3>
                    <p style={{ fontSize: "14px", color: "#374151", marginBottom: "12px" }}>
                      {line.description}
                    </p>

                    <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "12px" }}>
                      <strong>Approach:</strong> {line.approach} · <strong>Tone:</strong> {line.tone}
                    </div>

                    {line.focus_areas.length > 0 && (
                      <div style={{ marginBottom: "12px" }}>
                        <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                          Focus Areas:
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {line.focus_areas.map((area, idx) => (
                            <span
                              key={idx}
                              style={{
                                padding: "4px 8px",
                                borderRadius: "4px",
                                background: "#f3f4f6",
                                fontSize: "12px",
                              }}
                            >
                              {area}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {line.structure.sections.length > 0 && (
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "8px" }}>
                          Proposed Structure:
                        </div>
                        <div style={{ fontSize: "12px", color: "#6b7280" }}>
                          {line.structure.sections.map((s) => (
                            <div key={s.section_index} style={{ marginBottom: "4px" }}>
                              {s.section_index}. {s.title} — {s.description}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ========== WORD LIMIT ========== */}

      <div style={{ marginBottom: "40px" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "20px" }}>
          Output Length
        </h2>
        <div style={{ maxWidth: "400px" }}>
          <label style={{ fontSize: "13px", fontWeight: 600, display: "block", marginBottom: "8px" }}>
            Target Word Count (Optional)
          </label>
          <input
            type="number"
            value={wordLimit}
            onChange={(e) => {
              const value = e.target.value
              // Allow empty or valid numbers up to 5000
              if (value === "" || (parseInt(value, 10) > 0 && parseInt(value, 10) <= 5000)) {
                setWordLimit(value)
              }
            }}
            placeholder="e.g., 5000"
            min="1"
            max="5000"
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid #d1d5db",
              fontSize: "13px",
            }}
          />
          <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px" }}>
            Leave empty for default length (~2,340 words). Maximum: 5,000 words. 
            You can also specify this in your query text (e.g., "generate a 5000 word analysis").
          </div>
        </div>
      </div>

      {/* ========== PERSONALIZATION OPTIONS ========== */}

      {selectedApproach.argumentation_line_id && (
        <div style={{ marginBottom: "40px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "20px" }}>
            Personalization Options
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "20px" }}>
            {/* Tone */}
            <div>
              <label style={{ fontSize: "13px", fontWeight: 600, display: "block", marginBottom: "8px" }}>
                Tone
              </label>
              <select
                value={selectedApproach.tone}
                onChange={(e) =>
                  setSelectedApproach({ ...selectedApproach, tone: e.target.value })
                }
                style={{
                  width: "100%",
                  padding: "8px",
                  borderRadius: "6px",
                  border: "1px solid #d1d5db",
                  fontSize: "13px",
                }}
              >
                {synthesis.personalization_options.tone_options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px" }}>
                {synthesis.personalization_options.tone_options.find(
                  (o) => o.value === selectedApproach.tone
                )?.description}
              </div>
            </div>

            {/* Structure Type */}
            <div>
              <label style={{ fontSize: "13px", fontWeight: 600, display: "block", marginBottom: "8px" }}>
                Structure Type
              </label>
              <select
                value={selectedApproach.structure_type}
                onChange={(e) =>
                  setSelectedApproach({ ...selectedApproach, structure_type: e.target.value })
                }
                style={{
                  width: "100%",
                  padding: "8px",
                  borderRadius: "6px",
                  border: "1px solid #d1d5db",
                  fontSize: "13px",
                }}
              >
                {synthesis.personalization_options.structure_options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px" }}>
                {synthesis.personalization_options.structure_options.find(
                  (o) => o.value === selectedApproach.structure_type
                )?.description}
              </div>
            </div>

            {/* Focus Areas */}
            <div>
              <label style={{ fontSize: "13px", fontWeight: 600, display: "block", marginBottom: "8px" }}>
                Additional Focus Areas
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {synthesis.personalization_options.focus_options.map((opt) => (
                  <label
                    key={opt.value}
                    style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedApproach.focus_areas.includes(opt.value)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedApproach({
                            ...selectedApproach,
                            focus_areas: [...selectedApproach.focus_areas, opt.value],
                          })
                        } else {
                          setSelectedApproach({
                            ...selectedApproach,
                            focus_areas: selectedApproach.focus_areas.filter((f) => f !== opt.value),
                          })
                        }
                      }}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========== ACTIONS ========== */}

      <div style={{ display: "flex", gap: "12px", marginTop: "40px" }}>
        <Link
          href={`/projects/${projectId}/query?query=${encodeURIComponent(queryText || "")}`}
          style={{
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
        </Link>

        <button
          onClick={handleGenerate}
          disabled={!selectedApproach.argumentation_line_id && !selectedApproach.structure_type}
          style={{
            padding: "10px 18px",
            borderRadius: "8px",
            background: selectedApproach.argumentation_line_id || selectedApproach.structure_type ? "#111" : "#9ca3af",
            color: "#fff",
            fontSize: "14px",
            fontWeight: 500,
            border: "none",
            cursor: selectedApproach.argumentation_line_id || selectedApproach.structure_type ? "pointer" : "not-allowed",
          }}
        >
          Generate Project
        </button>
      </div>
    </div>
  )
}
