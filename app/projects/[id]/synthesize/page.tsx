"use client"

import { useEffect, useState, useRef } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"

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

type EvidenceCoverage = {
  argument_id: string
  supported_claims: number
  total_claims: number
  coverage_percentage: number
  weak_areas: string[]
  source_utilization: Array<{
    source_type: string
    chunk_count: number
    relevance: "high" | "medium" | "low"
  }>
}

type CombinationOptions = {
  allowed: boolean
  max_combine: number
  compatible_pairs: Array<[string, string]>
  combination_guidance: string
}

type SynthesizeResponse = {
  argumentation_lines: ArgumentationLine[]
  recommended_structure: RecommendedStructure
  personalization_options: {
    tone_options: PersonalizationOption[]
    structure_options: PersonalizationOption[]
    focus_options: PersonalizationOption[]
  }
  combination_options?: CombinationOptions
  evidence_coverage?: EvidenceCoverage[]
}

type SelectedApproach = {
  argumentation_line_id: string | null
  combined_line_ids?: string[] // NEW: Support for combining multiple lines
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
  const [loadedFromCache, setLoadedFromCache] = useState(false)

  const [selectedApproach, setSelectedApproach] = useState<SelectedApproach>({
    argumentation_line_id: null,
    combined_line_ids: [],
    tone: "",
    structure_type: "",
    focus_areas: [],
  })
  const [wordLimit, setWordLimit] = useState<string>("")
  const [combinationMode, setCombinationMode] = useState(false)
  const [queueStatus, setQueueStatus] = useState<{
    in_queue: boolean
    queue_position: number | null
    estimated_wait_seconds: number | null
    queue_mode_active: boolean
    total_queue_length: number
  } | null>(null)

  // Ref to prevent duplicate calls
  const synthesisInProgress = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Cache key for synthesis results
  const synthesisCacheKey = projectId && queryText ? `synthesis_${projectId}_${queryText.slice(0, 50).replace(/[^a-zA-Z0-9]/g, '_')}` : null
  
  // Cache key for user selections (localStorage - persists across sessions)
  const selectionsCacheKey = projectId && queryText ? `synthesize_selections_${projectId}_${queryText.slice(0, 50).replace(/[^a-zA-Z0-9]/g, '_')}` : null

  /* ================= LOAD USER SELECTIONS FROM CACHE ================= */
  
  useEffect(() => {
    if (!selectionsCacheKey || typeof window === "undefined") return
    
    try {
      const cachedSelections = localStorage.getItem(selectionsCacheKey)
      if (cachedSelections) {
        const parsed = JSON.parse(cachedSelections)
        if (parsed.selectedApproach) {
          setSelectedApproach(parsed.selectedApproach)
        }
        if (parsed.wordLimit !== undefined) {
          setWordLimit(parsed.wordLimit)
        }
        console.log("Loaded user selections from localStorage cache")
      }
    } catch (e) {
      console.error("Failed to load cached selections:", e)
      localStorage.removeItem(selectionsCacheKey)
    }
  }, [selectionsCacheKey])

  /* ================= SAVE USER SELECTIONS TO CACHE ================= */
  
  useEffect(() => {
    if (!selectionsCacheKey || typeof window === "undefined") return
    
    try {
      localStorage.setItem(selectionsCacheKey, JSON.stringify({
        selectedApproach,
        wordLimit,
      }))
    } catch (e) {
      console.warn("Failed to cache user selections:", e)
    }
  }, [selectedApproach, wordLimit, selectionsCacheKey])

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
      // Check for cached synthesis results first
      if (typeof window !== "undefined" && synthesisCacheKey) {
        const cachedSynthesis = sessionStorage.getItem(synthesisCacheKey)
        if (cachedSynthesis) {
          try {
            const parsedSynthesis = JSON.parse(cachedSynthesis)
            console.log(`Loaded synthesis from sessionStorage cache`)

            // Check if this is a back/forward navigation or refresh
            const navigationEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
            const isBackForwardOrReload = navigationEntry?.type === 'back_forward' || navigationEntry?.type === 'reload'

            if (isBackForwardOrReload) {
              console.log('Back/forward navigation or refresh detected - using cached data without API call')
              setSynthesis(parsedSynthesis)
              setLoadedFromCache(true)

              // Load user selections from localStorage if available, otherwise set defaults from cached data
              if (selectionsCacheKey && typeof window !== "undefined") {
                try {
                  const cachedSelections = localStorage.getItem(selectionsCacheKey)
                  if (cachedSelections) {
                    const parsed = JSON.parse(cachedSelections)
                    if (parsed.selectedApproach) {
                      setSelectedApproach(parsed.selectedApproach)
                    }
                    if (parsed.wordLimit !== undefined) {
                      setWordLimit(parsed.wordLimit)
                    }
                  } else if (parsedSynthesis.recommended_structure) {
                    // Set defaults from cached data only if no user selections exist
                    setSelectedApproach({
                      argumentation_line_id: null,
                      tone: parsedSynthesis.personalization_options.tone_options[0]?.value || "",
                      structure_type: parsedSynthesis.recommended_structure.type,
                      focus_areas: [],
                    })
                  }
                } catch (e) {
                  console.error("Failed to load cached selections:", e)
                  // Fall back to defaults
                  if (parsedSynthesis.recommended_structure) {
                    setSelectedApproach({
                      argumentation_line_id: null,
                      tone: parsedSynthesis.personalization_options.tone_options[0]?.value || "",
                      structure_type: parsedSynthesis.recommended_structure.type,
                      focus_areas: [],
                    })
                  }
                }
              } else if (parsedSynthesis.recommended_structure) {
                setSelectedApproach({
                  argumentation_line_id: null,
                  tone: parsedSynthesis.personalization_options.tone_options[0]?.value || "",
                  structure_type: parsedSynthesis.recommended_structure.type,
                  focus_areas: [],
                })
              }

              setSynthesizing(false)
              setLoading(false)
              return
            }
          } catch (e) {
            console.error("Failed to parse cached synthesis:", e)
            // Remove corrupted cache
            sessionStorage.removeItem(synthesisCacheKey)
          }
        }
      }

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

        // Get user info - required for authentication
        const { data: sessionData } = await supabase.auth.getSession()
        const user = sessionData.session?.user

        if (!user) {
          setError("Authentication required. Please log in and try again.")
          setSynthesizing(false)
          setLoading(false)
          router.replace("/login")
          return
        }

        // Check queue status before making request (optional - just for info)
        try {
          const queueStatusRes = await fetch(`/api/reasoning/queue-status?user_id=${encodeURIComponent(user.id)}&type=synthesis`)
          if (queueStatusRes.ok) {
            const queueData = await queueStatusRes.json()
            setQueueStatus(queueData)
          }
        } catch (e) {
          // Queue status check failed, continue anyway
          console.warn("Failed to check queue status:", e)
        }

        console.log("Calling synthesis API...")
        const res = await fetch("/api/reasoning/synthesize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            query_text: queryText,
            retrieved_chunks: retrievedChunks,
            user_id: user.id,
            user_email: user.email,
          }),
          signal: abortController.signal,
        })

        if (!res.ok) {
          const errorText = await res.text()
          console.error("Synthesis API error:", res.status, errorText)

          // Handle authentication errors
          if (res.status === 401) {
            throw new Error("Authentication required. Please log in and try again.")
          }

          // Handle authorization errors
          if (res.status === 403) {
            throw new Error("Access denied. You don't have permission to access this project.")
          }

          // Handle specific case where synthesis is busy
          if (res.status === 429 && errorText.includes("Please try again in 5 minutes")) {
            throw new Error("Synthesis is currently busy with another request. Please try again in 5 minutes.")
          }

          // Handle case where generation is in progress (should use cache instead)
          if (res.status === 429 && errorText.includes("Generation is currently in progress")) {
            throw new Error("Another user is currently generating content. Synthesis analysis is cached - please refresh the page if you need updated results.")
          }

          // Handle queue timeout
          if (res.status === 504 && errorText.includes("timed out in queue")) {
            throw new Error("Request timed out in queue. The system is experiencing high load. Please try again in a few minutes.")
          }

          throw new Error(`Synthesis failed: ${res.status} ${errorText}`)
        }

        const data = await res.json()
        console.log("Synthesis response received:", data)
        
        // Check if response indicates queued status (202 Accepted)
        if (res.status === 202 || data.queued) {
          setQueueStatus({
            in_queue: true,
            queue_position: data.queue_position || null,
            estimated_wait_seconds: data.estimated_wait_seconds || null,
            queue_mode_active: true,
            total_queue_length: data.total_queue_length || 0,
          })
          
          // Start polling for queue status and retry when queue clears
          const pollInterval = setInterval(async () => {
            try {
              const statusRes = await fetch(`/api/reasoning/queue-status?user_id=${encodeURIComponent(user.id)}&type=synthesis`)
              if (statusRes.ok) {
                const status = await statusRes.json()
                setQueueStatus(status)
                if (!status.in_queue) {
                  clearInterval(pollInterval)
                  // Retry the request after queue clears
                  synthesisInProgress.current = false
                  setTimeout(() => {
                    synthesize()
                  }, 1000)
                }
              }
            } catch (e) {
              console.error("Queue status poll error:", e)
            }
          }, 2000)
          
          // Cleanup on unmount
          return () => clearInterval(pollInterval)
        }
        
        setSynthesis(data)
        setLoadedFromCache(false)

        // Cache the synthesis results in sessionStorage
        if (typeof window !== "undefined" && synthesisCacheKey) {
          try {
            sessionStorage.setItem(synthesisCacheKey, JSON.stringify(data))
            console.log(`Cached synthesis results in sessionStorage`)
          } catch (e) {
            console.warn("Failed to cache synthesis results:", e)
          }
        }

        // Load user selections from localStorage if available, otherwise set defaults
        if (selectionsCacheKey && typeof window !== "undefined") {
          try {
            const cachedSelections = localStorage.getItem(selectionsCacheKey)
            if (cachedSelections) {
              const parsed = JSON.parse(cachedSelections)
              if (parsed.selectedApproach) {
                setSelectedApproach(parsed.selectedApproach)
              }
              if (parsed.wordLimit !== undefined) {
                setWordLimit(parsed.wordLimit)
              }
            } else if (data.recommended_structure) {
              // Set defaults from data only if no user selections exist
              setSelectedApproach({
                argumentation_line_id: null,
                tone: data.personalization_options.tone_options[0]?.value || "",
                structure_type: data.recommended_structure.type,
                focus_areas: [],
              })
            }
          } catch (e) {
            console.error("Failed to load cached selections:", e)
            // Fall back to defaults
            if (data.recommended_structure) {
              setSelectedApproach({
                argumentation_line_id: null,
                tone: data.personalization_options.tone_options[0]?.value || "",
                structure_type: data.recommended_structure.type,
                focus_areas: [],
              })
            }
          }
        } else if (data.recommended_structure) {
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
    // Support both single selection and combination mode
    const hasSingleSelection = selectedApproach.argumentation_line_id
    const hasCombinedSelection = selectedApproach.combined_line_ids && selectedApproach.combined_line_ids.length > 0
    
    if (!hasSingleSelection && !hasCombinedSelection && !selectedApproach.structure_type) {
      alert("Please select an argumentation approach or structure")
      return
    }

    let selectedLine = null
    let combinedLines: ArgumentationLine[] = []
    
    if (hasCombinedSelection && synthesis) {
      // Combine multiple argumentation lines
      combinedLines = synthesis.argumentation_lines.filter(
        l => selectedApproach.combined_line_ids?.includes(l.id)
      )
      
      if (combinedLines.length > 0) {
        // Merge focus areas and create combined structure
        const mergedFocusAreas = [...new Set(combinedLines.flatMap(l => l.focus_areas))]
        const mergedSections = combinedLines[0].structure.sections.map((section, idx) => ({
          ...section,
          description: combinedLines.map(l => l.structure.sections[idx]?.description || "").join(" / ")
        }))
        
        selectedLine = {
          ...combinedLines[0],
          id: `combined-${combinedLines.map(l => l.id).join("-")}`,
          title: `Combined: ${combinedLines.map(l => l.title).join(" + ")}`,
          description: combinedLines.map(l => l.description).join(" Additionally, "),
          focus_areas: mergedFocusAreas,
          structure: { sections: mergedSections },
        }
      }
    } else if (hasSingleSelection && synthesis) {
      selectedLine = synthesis.argumentation_lines.find(
        (l) => l.id === selectedApproach.argumentation_line_id
      )
    }

    const params = new URLSearchParams({
      query: queryText || "",
      approach: JSON.stringify({
        argumentation_line: selectedLine || null,
        combined_lines: combinedLines.length > 0 ? combinedLines : undefined,
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
        {queueStatus?.in_queue && (
          <div style={{
            maxWidth: "600px",
            margin: "16px auto 0",
            padding: "16px",
            background: "#fef3c7",
            border: "1px solid #f59e0b",
            borderRadius: "8px",
            color: "#92400e",
            marginBottom: "16px"
          }}>
            <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>
              ⏳ Request Queued
            </div>
            <div style={{ fontSize: "13px", marginBottom: "4px" }}>
              Position in queue: <strong>{queueStatus.queue_position}</strong> of {queueStatus.total_queue_length}
            </div>
            {queueStatus.estimated_wait_seconds && (
              <div style={{ fontSize: "13px" }}>
                Estimated wait: <strong>{Math.ceil(queueStatus.estimated_wait_seconds / 60)} minutes</strong>
              </div>
            )}
            <div style={{ fontSize: "12px", marginTop: "8px", color: "#78350f" }}>
              The system is experiencing high load. Your request will be processed automatically when it reaches the front of the queue.
            </div>
          </div>
        )}
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
  if (error && !synthesis) {
    const isGenerationBusyError = error.includes("Another user is currently generating content")

    return (
      <div style={{ padding: "80px", color: "#b91c1c" }}>
        <h2>{isGenerationBusyError ? "Generation In Progress" : "Unable to Synthesize Approaches"}</h2>
        <p style={{ fontSize: "16px", marginBottom: "16px" }}>{error}</p>
        {isGenerationBusyError && (
          <div style={{
            background: "#fef3c7",
            border: "1px solid #f59e0b",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "24px",
            color: "#92400e"
          }}>
            <strong>💡 Tip:</strong> Wait for generation to complete, then return to this page for fresh synthesis analysis. Your previous synthesis results are cached.
          </div>
        )}
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
      <div style={{ marginBottom: "16px" }}>
        <Link
          href={`/projects/${projectId}/query?query=${encodeURIComponent(queryText || "")}`}
          style={{
            padding: "8px 16px",
            borderRadius: "6px",
            background: "#ffffff",
            color: "#374151",
            fontSize: "14px",
            fontWeight: 500,
            textDecoration: "none",
            border: "1px solid #e5e7eb",
            display: "inline-flex",
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
          ← Back to Query
        </Link>
      </div>
      <h1 style={{ fontSize: "26px", fontWeight: 700, marginBottom: "12px" }}>
        Argumentation Strategy
      </h1>

      <p style={{ fontSize: "14px", color: "#6b7280", marginBottom: "32px" }}>
        Query: <em>{queryText}</em>
      </p>

      {loadedFromCache && (
        <div style={{
          padding: "8px 12px",
          background: "#f0fdf4",
          border: "1px solid #bbf7d0",
          borderRadius: "6px",
          marginBottom: "24px",
          fontSize: "12px",
          color: "#166534"
        }}>
          ✓ Analysis loaded from cache (for faster performance)
        </div>
      )}

      {/* ========== ARGUMENTATION LINES ========== */}

      <div style={{ marginBottom: "40px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>
            Select Argumentation Approach
          </h2>
          
          {/* Combination Mode Toggle */}
          {synthesis.combination_options?.allowed && (
            <button
              onClick={() => {
                setCombinationMode(!combinationMode)
                if (!combinationMode) {
                  // Switching to combination mode - clear single selection
                  setSelectedApproach(prev => ({
                    ...prev,
                    argumentation_line_id: null,
                    combined_line_ids: [],
                  }))
                } else {
                  // Switching to single mode - clear combinations
                  setSelectedApproach(prev => ({
                    ...prev,
                    combined_line_ids: [],
                  }))
                }
              }}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: combinationMode ? "2px solid #2563eb" : "1px solid #d1d5db",
                background: combinationMode ? "#eff6ff" : "#fff",
                color: combinationMode ? "#2563eb" : "#374151",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                transition: "all 0.2s",
              }}
            >
              {combinationMode ? "✓ Combination Mode" : "🔗 Combine Approaches"}
            </button>
          )}
        </div>

        {combinationMode && synthesis.combination_options && (
          <div style={{
            padding: "16px",
            background: "#f0f9ff",
            border: "1px solid #bae6fd",
            borderRadius: "8px",
            marginBottom: "20px",
            fontSize: "13px",
            color: "#0c4a6e",
          }}>
            <strong>💡 Combination Mode:</strong> {synthesis.combination_options.combination_guidance}
            <br />
            <span style={{ fontSize: "12px", color: "#0369a1" }}>
              Select up to {synthesis.combination_options.max_combine} approaches to combine.
              {selectedApproach.combined_line_ids && selectedApproach.combined_line_ids.length > 0 && (
                <span style={{ marginLeft: "8px", fontWeight: 600 }}>
                  ({selectedApproach.combined_line_ids.length} selected)
                </span>
              )}
            </span>
          </div>
        )}

        <div style={{ display: "grid", gap: "16px" }}>
          {synthesis.argumentation_lines.map((line) => {
            const isSelected = combinationMode
              ? selectedApproach.combined_line_ids?.includes(line.id)
              : selectedApproach.argumentation_line_id === line.id
            
            // Get evidence coverage for this line
            const coverage = synthesis.evidence_coverage?.find(c => c.argument_id === line.id)
            
            // Check compatibility in combination mode
            const isCompatibleWithSelected = combinationMode && synthesis.combination_options?.compatible_pairs.some(
              ([a, b]) => 
                (selectedApproach.combined_line_ids?.includes(a) && b === line.id) ||
                (selectedApproach.combined_line_ids?.includes(b) && a === line.id) ||
                (selectedApproach.combined_line_ids?.length === 0)
            )
            
            const canSelect = !combinationMode || 
              isSelected || 
              (selectedApproach.combined_line_ids?.length || 0) < (synthesis.combination_options?.max_combine || 2) && isCompatibleWithSelected

            return (
              <div
                key={line.id}
                onClick={() => {
                  if (!canSelect && !isSelected) return
                  
                  if (combinationMode) {
                    // Toggle selection in combination mode
                    const currentIds = selectedApproach.combined_line_ids || []
                    if (currentIds.includes(line.id)) {
                      setSelectedApproach({
                        ...selectedApproach,
                        combined_line_ids: currentIds.filter(id => id !== line.id),
                      })
                    } else if (currentIds.length < (synthesis.combination_options?.max_combine || 2)) {
                      setSelectedApproach({
                        ...selectedApproach,
                        combined_line_ids: [...currentIds, line.id],
                        tone: line.tone,
                        structure_type: synthesis.recommended_structure.type,
                      })
                    }
                  } else {
                    setSelectedApproach({
                      ...selectedApproach,
                      argumentation_line_id: line.id,
                      combined_line_ids: [],
                      tone: line.tone,
                      structure_type: synthesis.recommended_structure.type,
                      focus_areas: line.focus_areas,
                    })
                  }
                }}
                style={{
                  border: `2px solid ${isSelected ? "#2563eb" : "#e5e7eb"}`,
                  borderRadius: "12px",
                  padding: "20px",
                  cursor: canSelect || isSelected ? "pointer" : "not-allowed",
                  background: isSelected ? "#eff6ff" : !canSelect && combinationMode ? "#f9fafb" : "#fff",
                  opacity: !canSelect && combinationMode && !isSelected ? 0.5 : 1,
                  transition: "all 0.2s",
                }}
              >
                <div style={{ display: "flex", alignItems: "start", gap: "12px" }}>
                  <input
                    type={combinationMode ? "checkbox" : "radio"}
                    checked={isSelected}
                    disabled={!canSelect && !isSelected}
                    onChange={() => {}}
                    style={{ marginTop: "4px" }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                      <h3 style={{ fontSize: "16px", fontWeight: 600, margin: 0 }}>
                        {line.title}
                      </h3>
                      
                      {/* Evidence Coverage Badge */}
                      {coverage && (
                        <span style={{
                          padding: "4px 10px",
                          borderRadius: "12px",
                          fontSize: "11px",
                          fontWeight: 600,
                          background: coverage.coverage_percentage >= 80 ? "#dcfce7" : 
                                     coverage.coverage_percentage >= 60 ? "#fef9c3" : "#fee2e2",
                          color: coverage.coverage_percentage >= 80 ? "#166534" : 
                                coverage.coverage_percentage >= 60 ? "#854d0e" : "#991b1b",
                        }}>
                          {coverage.coverage_percentage}% supported
                        </span>
                      )}
                    </div>
                    
                    <p style={{ fontSize: "14px", color: "#374151", marginBottom: "12px" }}>
                      {line.description}
                    </p>

                    <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "12px" }}>
                      <strong>Approach:</strong> {line.approach} · <strong>Tone:</strong> {line.tone}
                    </div>

                    {/* Weak Areas Warning */}
                    {coverage && coverage.weak_areas.length > 0 && (
                      <div style={{
                        padding: "10px 12px",
                        background: "#fef3c7",
                        border: "1px solid #fde68a",
                        borderRadius: "6px",
                        marginBottom: "12px",
                        fontSize: "12px",
                        color: "#92400e",
                      }}>
                        <strong>⚠️ Areas needing more evidence:</strong>
                        <ul style={{ margin: "4px 0 0 0", paddingLeft: "16px" }}>
                          {coverage.weak_areas.slice(0, 3).map((area, idx) => (
                            <li key={idx}>{area}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Source Utilization */}
                    {coverage && coverage.source_utilization && coverage.source_utilization.length > 0 && (
                      <div style={{ marginBottom: "12px" }}>
                        <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>
                          Source Coverage:
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {coverage.source_utilization.slice(0, 5).map((source, idx) => (
                            <span
                              key={idx}
                              style={{
                                padding: "3px 8px",
                                borderRadius: "4px",
                                background: source.relevance === "high" ? "#dcfce7" : 
                                           source.relevance === "medium" ? "#fef9c3" : "#f3f4f6",
                                fontSize: "11px",
                                color: source.relevance === "high" ? "#166534" : 
                                      source.relevance === "medium" ? "#854d0e" : "#6b7280",
                              }}
                            >
                              {source.source_type}: {source.chunk_count}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

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

      {(selectedApproach.argumentation_line_id || (selectedApproach.combined_line_ids && selectedApproach.combined_line_ids.length > 0)) && (
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

      {/* ========== SELECTION SUMMARY ========== */}
      
      {(selectedApproach.argumentation_line_id || (selectedApproach.combined_line_ids && selectedApproach.combined_line_ids.length > 0)) && (
        <div style={{
          padding: "20px",
          background: "#f0f9ff",
          border: "1px solid #bae6fd",
          borderRadius: "12px",
          marginBottom: "24px",
        }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "#0c4a6e", marginBottom: "8px" }}>
            Selected Approach{selectedApproach.combined_line_ids && selectedApproach.combined_line_ids.length > 1 ? "es" : ""}:
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {combinationMode && selectedApproach.combined_line_ids && selectedApproach.combined_line_ids.length > 0 ? (
              selectedApproach.combined_line_ids.map(id => {
                const line = synthesis.argumentation_lines.find(l => l.id === id)
                return line ? (
                  <span key={id} style={{
                    padding: "6px 12px",
                    background: "#dbeafe",
                    borderRadius: "6px",
                    fontSize: "13px",
                    color: "#1e40af",
                    fontWeight: 500,
                  }}>
                    {line.title}
                  </span>
                ) : null
              })
            ) : (
              <span style={{
                padding: "6px 12px",
                background: "#dbeafe",
                borderRadius: "6px",
                fontSize: "13px",
                color: "#1e40af",
                fontWeight: 500,
              }}>
                {synthesis.argumentation_lines.find(l => l.id === selectedApproach.argumentation_line_id)?.title}
              </span>
            )}
          </div>
          {combinationMode && selectedApproach.combined_line_ids && selectedApproach.combined_line_ids.length > 1 && (
            <div style={{ marginTop: "12px", fontSize: "12px", color: "#0369a1" }}>
              These approaches will be merged to create a comprehensive argument structure.
            </div>
          )}
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
          disabled={!selectedApproach.argumentation_line_id && !selectedApproach.structure_type && !(selectedApproach.combined_line_ids && selectedApproach.combined_line_ids.length > 0)}
          style={{
            padding: "10px 18px",
            borderRadius: "8px",
            background: selectedApproach.argumentation_line_id || selectedApproach.structure_type || (selectedApproach.combined_line_ids && selectedApproach.combined_line_ids.length > 0) ? "#111" : "#9ca3af",
            color: "#fff",
            fontSize: "14px",
            fontWeight: 500,
            border: "none",
            cursor: selectedApproach.argumentation_line_id || selectedApproach.structure_type || (selectedApproach.combined_line_ids && selectedApproach.combined_line_ids.length > 0) ? "pointer" : "not-allowed",
          }}
        >
          {selectedApproach.combined_line_ids && selectedApproach.combined_line_ids.length > 1 
            ? `Generate with ${selectedApproach.combined_line_ids.length} Combined Approaches`
            : "Generate Project"}
        </button>
      </div>
    </div>
  )
}
