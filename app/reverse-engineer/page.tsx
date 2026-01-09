"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"

/* ================= SOURCE CATEGORY CONFIG ================= */

const SOURCE_CATEGORIES: {
  label: string
  options: { value: string; label: string }[]
}[] = [
  {
    label: "Primary Law",
    options: [
      { value: "case", label: "Case" },
      { value: "statute", label: "Statute" },
      { value: "regulation", label: "Regulation" },
      { value: "constitution", label: "Constitution" },
      { value: "treaty", label: "Treaty" },
    ],
  },
  {
    label: "Academic / Secondary",
    options: [
      { value: "journal_article", label: "Journal Article" },
      { value: "book", label: "Book" },
      { value: "commentary", label: "Commentary / Textbook" },
      { value: "working_paper", label: "Working Paper" },
      { value: "thesis", label: "Thesis / Dissertation" },
    ],
  },
  {
    label: "Policy / Institutional",
    options: [
      { value: "committee_report", label: "Committee Report" },
      { value: "law_commission_report", label: "Law Commission Report" },
      { value: "white_paper", label: "White Paper" },
      { value: "government_report", label: "Government Report" },
    ],
  },
  {
    label: "Digital / Informal",
    options: [
      { value: "blog_post", label: "Blog Post" },
      { value: "news_article", label: "News Article" },
      { value: "website", label: "Website" },
      { value: "other", label: "Other" },
    ],
  },
]

/* ================= TYPES ================= */

type SourceFile = {
  file: File
  id: string
  type: string
  title: string
}

type SourceChunkMatch = {
  chunk_id: string
  source_id: string
  source_title: string
  source_type: string
  text: string
  page_number: number
  paragraph_index: number
  similarity: number
}

type CitationMatch = {
  citation_text: string
  source_chunk_id: string
  source_id: string
  source_title: string
  source_type: string
  source_chunk_text: string
  source_page_number: number
  match_confidence: number
  match_type: "citation" | "semantic"
}

type ClaimWithFootnote = {
  claim_text: string
  footnote_number: number
  footnote_text: string
  char_start: number
  char_end: number
  page_number: number
}

type ClaimVerification = {
  claim_text: string
  footnote_number: number
  footnote_text: string
  source_id: string
  source_title: string
  source_type: string
  supporting_chunks: Array<{
    chunk_id: string
    chunk_text: string
    page_number: number
    support_score: number
    reasoning?: string
  }>
  verification_score: number
  overall_assessment?: string
}

type ProjectChunkAnalysis = {
  chunk_index: number
  text: string
  char_start: number
  char_end: number
  page_number?: number
  claims_with_footnotes?: ClaimWithFootnote[]
  claim_verifications?: ClaimVerification[]
  matches: SourceChunkMatch[]
  avg_similarity: number
  max_similarity: number
  sources_represented: string[]
}

type AnalysisResult = {
  project_chunks: ProjectChunkAnalysis[]
  overall_stats: {
    total_chunks: number
    total_footnotes: number
    footnotes_matched: number
    claims_verified: number
    avg_verification_score: number
    avg_similarity_across_all: number
    sources_covered: number
    sources_covered_details: Array<{
      source_id: string
      source_title: string
      source_type: string
      match_count: number
      avg_similarity: number
      footnote_matches: number
    }>
    chunks_with_high_similarity: number
    chunks_with_medium_similarity: number
    chunks_with_low_similarity: number
    all_footnotes?: Array<{
      footnote_number: number
      footnote_text: string
      page_number: number
      has_verification: boolean
      verification_score: number
      matched_source: string | null
      has_claim: boolean
    }>
  }
}

/* ================= COMPONENT ================= */

export default function ReverseEngineerPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [sources, setSources] = useState<SourceFile[]>([])
  const [projectText, setProjectText] = useState("")
  const [projectPdf, setProjectPdf] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState<{
    stage: string
    progress: number
  } | null>(null)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedChunk, setExpandedChunk] = useState<number | null>(null)

  /* ================= CHECK AUTH ================= */

  useEffect(() => {
    const checkAuth = async () => {
      const { data: session } = await supabase.auth.getSession()
      if (!session.session?.user) {
        router.replace("/login")
        return
      }
      setAuthenticated(true)
      setLoading(false)
    }
    checkAuth()
  }, [router])

  /* ================= FILE HANDLING ================= */

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const pdfFiles = files.filter(f => f.type === "application/pdf")

    if (files.length !== pdfFiles.length) {
      alert("Only PDF files are supported. Non-PDF files were ignored.")
    }

    const newSources = pdfFiles.map(file => ({
      file,
      id: `${Date.now()}-${Math.random()}`,
      type: SOURCE_CATEGORIES[0].options[0].value,
      title: file.name.replace(/\.pdf$/i, ""),
    }))

    setSources(prev => [...prev, ...newSources])
  }

  const removeSource = (id: string) => {
    setSources(prev => prev.filter(s => s.id !== id))
  }

  const updateSourceType = (id: string, type: string) => {
    setSources(prev =>
      prev.map(s => (s.id === id ? { ...s, type } : s))
    )
  }

  const updateSourceTitle = (id: string, title: string) => {
    setSources(prev =>
      prev.map(s => (s.id === id ? { ...s, title } : s))
    )
  }

  /* ================= ANALYZE ================= */

  const handleProjectPdfSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type === "application/pdf") {
      setProjectPdf(file)
      setProjectText("") // Clear text if PDF is selected
    } else if (file) {
      alert("Only PDF files are supported for project upload")
    }
  }

  const handleAnalyze = async () => {
    if ((!projectText.trim() && !projectPdf) || sources.length === 0 || analyzing) return

    setAnalyzing(true)
    setError(null)
    setAnalysisResult(null)
    setAnalysisProgress({ stage: "Preparing files...", progress: 5 })

    try {
      // Convert source files to base64
      setAnalysisProgress({ stage: "Processing source files...", progress: 10 })
      const sourcesData = await Promise.all(
        sources.map(async (source, idx) => {
          setAnalysisProgress({
            stage: `Processing ${source.file.name}...`,
            progress: 10 + (idx / sources.length) * 20,
          })
          const buffer = await source.file.arrayBuffer()
          // Convert ArrayBuffer to base64
          const bytes = new Uint8Array(buffer)
          const binary = bytes.reduce((acc, byte) => acc + String.fromCharCode(byte), "")
          const base64 = btoa(binary)
          return {
            name: source.file.name,
            type: source.type,
            title: source.title,
            buffer: base64,
          }
        })
      )

      setAnalysisProgress({ stage: "Uploading and analyzing...", progress: 35 })
      const formData = new FormData()
      if (projectPdf) {
        formData.append("project_pdf", projectPdf)
      } else if (projectText) {
        formData.append("project_text", projectText)
      }
      formData.append("sources", JSON.stringify(sourcesData))

      // Simulate progress updates during analysis
      const progressInterval = setInterval(() => {
        setAnalysisProgress(prev => {
          if (!prev) return null
          const newProgress = Math.min(prev.progress + 2, 90)
          let stage = prev.stage
          if (newProgress > 50 && prev.stage === "Uploading and analyzing...") {
            stage = "Extracting text and citations..."
          } else if (newProgress > 70 && prev.stage === "Extracting text and citations...") {
            stage = "Matching citations to sources..."
          } else if (newProgress > 85 && prev.stage === "Matching citations to sources...") {
            stage = "Computing semantic similarities..."
          }
          return { stage, progress: newProgress }
        })
      }, 500)

      const res = await fetch("/api/reverse-engineer/analyze", {
        method: "POST",
        body: formData,
      })

      clearInterval(progressInterval)
      setAnalysisProgress({ stage: "Finalizing results...", progress: 95 })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || "Analysis failed")
      }

      const result = await res.json()
      setAnalysisProgress({ stage: "Complete!", progress: 100 })
      setTimeout(() => {
        setAnalysisResult(result)
        setAnalysisProgress(null)
      }, 500)
    } catch (err: any) {
      setError(err?.message || "Analysis failed")
      setAnalysisProgress(null)
    } finally {
      setAnalyzing(false)
    }
  }

  /* ================= RENDER ================= */

  if (loading) {
    return (
      <div style={{ padding: "80px", textAlign: "center", color: "#666" }}>
        Loading...
      </div>
    )
  }

  if (!authenticated) return null

  const getSimilarityColor = (similarity: number) => {
    if (similarity > 0.7) return "#10b981"
    if (similarity >= 0.5) return "#f59e0b"
    return "#ef4444"
  }

  const getSimilarityLabel = (similarity: number) => {
    if (similarity > 0.7) return "High"
    if (similarity >= 0.5) return "Medium"
    return "Low"
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "40px 20px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 700, marginBottom: "8px" }}>
          Reverse Engineering Analysis
        </h1>
        <p style={{ fontSize: "14px", color: "#6b7280", marginBottom: "32px" }}>
          Upload sources and a premade project to analyze how closely they relate
        </p>

        {/* SOURCES SECTION */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "16px" }}>
            Sources (PDF)
          </h2>

          <input
            type="file"
            accept="application/pdf"
            multiple
            onChange={handleFileSelect}
            style={{
              width: "100%",
              padding: "8px",
              borderRadius: "6px",
              border: "1px solid #d1d5db",
              fontSize: "13px",
              marginBottom: "16px",
            }}
          />

          {sources.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {sources.map(source => (
                <div
                  key={source.id}
                  style={{
                    padding: "12px",
                    background: "#f9fafb",
                    borderRadius: "8px",
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 200px 120px auto", gap: "12px", alignItems: "center" }}>
                    <input
                      value={source.title}
                      onChange={e => updateSourceTitle(source.id, e.target.value)}
                      placeholder="Source title"
                      style={{
                        padding: "6px 8px",
                        borderRadius: "6px",
                        border: "1px solid #d1d5db",
                        fontSize: "13px",
                      }}
                    />
                    <select
                      value={source.type}
                      onChange={e => updateSourceType(source.id, e.target.value)}
                      style={{
                        padding: "6px 8px",
                        borderRadius: "6px",
                        border: "1px solid #d1d5db",
                        fontSize: "13px",
                      }}
                    >
                      {SOURCE_CATEGORIES.map(cat => (
                        <optgroup key={cat.label} label={cat.label}>
                          {cat.options.map(opt => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <div style={{ fontSize: "12px", color: "#6b7280" }}>
                      {(source.file.size / 1024 / 1024).toFixed(2)} MB
                    </div>
                    <button
                      onClick={() => removeSource(source.id)}
                      style={{
                        padding: "6px 12px",
                        background: "none",
                        border: "1px solid #dc2626",
                        borderRadius: "6px",
                        color: "#dc2626",
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* PROJECT SECTION */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "16px" }}>
            Premade Project (PDF or Text)
          </h2>

          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "8px", color: "#374151" }}>
              Upload Project PDF (recommended - extracts citations automatically)
            </label>
            <input
              type="file"
              accept="application/pdf"
              onChange={handleProjectPdfSelect}
              disabled={analyzing}
              style={{
                width: "100%",
                padding: "8px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                fontSize: "13px",
              }}
            />
            {projectPdf && (
              <div style={{ marginTop: "8px", fontSize: "12px", color: "#6b7280" }}>
                Selected: {projectPdf.name} ({(projectPdf.size / 1024 / 1024).toFixed(2)} MB)
                <button
                  onClick={() => setProjectPdf(null)}
                  style={{
                    marginLeft: "8px",
                    padding: "2px 8px",
                    background: "none",
                    border: "1px solid #dc2626",
                    borderRadius: "4px",
                    color: "#dc2626",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  Remove
                </button>
              </div>
            )}
          </div>

          <div style={{ marginBottom: "16px", textAlign: "center", color: "#9ca3af", fontSize: "12px" }}>
            OR
          </div>

          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: "8px", color: "#374151" }}>
              Paste Project Text
            </label>
            <textarea
              value={projectText}
              onChange={e => {
                setProjectText(e.target.value)
                if (e.target.value) setProjectPdf(null) // Clear PDF if text is entered
              }}
              placeholder="Paste your premade project text here..."
              disabled={analyzing || !!projectPdf}
              style={{
                width: "100%",
                minHeight: "300px",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid #d1d5db",
                fontSize: "14px",
                fontFamily: "monospace",
                lineHeight: 1.6,
                resize: "vertical",
                opacity: projectPdf ? 0.5 : 1,
              }}
            />
          </div>

          <button
            onClick={handleAnalyze}
            disabled={analyzing || (!projectText.trim() && !projectPdf) || sources.length === 0}
            style={{
              marginTop: "16px",
              padding: "10px 20px",
              borderRadius: "8px",
              background: analyzing || (!projectText.trim() && !projectPdf) || sources.length === 0 ? "#9ca3af" : "#111",
              color: "#fff",
              fontSize: "14px",
              fontWeight: 600,
              border: "none",
              cursor: analyzing || (!projectText.trim() && !projectPdf) || sources.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            {analyzing ? "Analyzing..." : "Analyze Relationship to Sources"}
          </button>

          {/* PROGRESS INDICATOR */}
          {analyzing && analysisProgress && (
            <div style={{ marginTop: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ fontSize: "13px", fontWeight: 500, color: "#374151" }}>
                  {analysisProgress.stage}
                </span>
                <span style={{ fontSize: "13px", color: "#6b7280" }}>
                  {Math.round(analysisProgress.progress)}%
                </span>
              </div>
              <div
                style={{
                  height: "8px",
                  background: "#e5e7eb",
                  borderRadius: "4px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${analysisProgress.progress}%`,
                    height: "100%",
                    background: "#111",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* ERROR */}
        {error && (
          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "8px",
              padding: "16px",
              marginBottom: "24px",
              color: "#dc2626",
            }}
          >
            {error}
          </div>
        )}

        {/* RESULTS */}
        {analysisResult && (
          <div>
            {/* OVERALL STATS */}
            <div
              style={{
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: "12px",
                padding: "24px",
                marginBottom: "24px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              }}
            >
              <h2 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "20px" }}>
                Overall Analysis
              </h2>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "24px" }}>
                <div>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>
                    Total Chunks Analyzed
                  </div>
                  <div style={{ fontSize: "24px", fontWeight: 700 }}>
                    {analysisResult.overall_stats.total_chunks}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>
                    Total Footnotes Found
                  </div>
                  <div style={{ fontSize: "24px", fontWeight: 700 }}>
                    {analysisResult.overall_stats.total_footnotes}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>
                    Claims Verified
                  </div>
                  <div style={{ fontSize: "24px", fontWeight: 700, color: analysisResult.overall_stats.claims_verified > 0 ? "#10b981" : "#6b7280" }}>
                    {analysisResult.overall_stats.claims_verified}
                  </div>
                  {analysisResult.overall_stats.total_footnotes > 0 && (
                    <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                      of {analysisResult.overall_stats.total_footnotes} footnotes
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>
                    Avg Verification Score
                  </div>
                  <div style={{ fontSize: "24px", fontWeight: 700, color: getSimilarityColor(analysisResult.overall_stats.avg_verification_score) }}>
                    {(analysisResult.overall_stats.avg_verification_score * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>
                    Average Similarity
                  </div>
                  <div style={{ fontSize: "24px", fontWeight: 700 }}>
                    {(analysisResult.overall_stats.avg_similarity_across_all * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>
                    Sources Covered
                  </div>
                  <div style={{ fontSize: "24px", fontWeight: 700 }}>
                    {analysisResult.overall_stats.sources_covered}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>
                    High Similarity Chunks
                  </div>
                  <div style={{ fontSize: "24px", fontWeight: 700, color: "#10b981" }}>
                    {analysisResult.overall_stats.chunks_with_high_similarity}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>
                    Medium Similarity Chunks
                  </div>
                  <div style={{ fontSize: "24px", fontWeight: 700, color: "#f59e0b" }}>
                    {analysisResult.overall_stats.chunks_with_medium_similarity}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>
                    Low Similarity Chunks
                  </div>
                  <div style={{ fontSize: "24px", fontWeight: 700, color: "#ef4444" }}>
                    {analysisResult.overall_stats.chunks_with_low_similarity}
                  </div>
                </div>
              </div>

              {/* SOURCE COVERAGE */}
              <div>
                <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "12px" }}>
                  Source Coverage Details
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {analysisResult.overall_stats.sources_covered_details.map(source => (
                    <div
                      key={source.source_id}
                      style={{
                        padding: "12px",
                        background: "#f9fafb",
                        borderRadius: "6px",
                        border: "1px solid #e5e7eb",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 500 }}>
                          {source.source_title}
                        </div>
                        <div style={{ fontSize: "12px", color: "#6b7280" }}>
                          {source.source_type} · {source.match_count} semantic match{source.match_count !== 1 ? "es" : ""}
                          {source.footnote_matches > 0 && ` · ${source.footnote_matches} footnote match${source.footnote_matches !== 1 ? "es" : ""}`}
                        </div>
                      </div>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: getSimilarityColor(source.avg_similarity) }}>
                        {(source.avg_similarity * 100).toFixed(1)}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* FOOTNOTES SECTION */}
            <div
              style={{
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: "12px",
                padding: "24px",
                marginBottom: "24px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "20px" }}>
                <div>
                  <h2 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "4px" }}>
                    Footnotes Analysis
                  </h2>
                  <p style={{ fontSize: "14px", color: "#6b7280" }}>
                    All footnotes found in the document with their verification status and matched sources
                  </p>
                </div>
                {analysisResult.overall_stats.all_footnotes && (
                  <div style={{ display: "flex", gap: "16px" }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>
                        Verified
                      </div>
                      <div style={{ fontSize: "20px", fontWeight: 700, color: "#10b981" }}>
                        {analysisResult.overall_stats.all_footnotes.filter(f => f.has_verification).length}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>
                        Not Verified
                      </div>
                      <div style={{ fontSize: "20px", fontWeight: 700, color: "#9ca3af" }}>
                        {analysisResult.overall_stats.all_footnotes.filter(f => !f.has_verification).length}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {(() => {
                  // Use footnotes from overall_stats if available, otherwise collect from chunks
                  let sortedFootnotes: Array<{
                    footnote_number: number
                    footnote_text: string
                    verifications: ClaimVerification[]
                    claims: ClaimWithFootnote[]
                  }> = []

                  if (analysisResult.overall_stats.all_footnotes) {
                    // Use the comprehensive list from API
                    const allFootnotesMap = new Map<number, {
                      footnote_number: number
                      footnote_text: string
                      verifications: ClaimVerification[]
                      claims: ClaimWithFootnote[]
                    }>()

                    // Initialize from API data
                    analysisResult.overall_stats.all_footnotes.forEach(fn => {
                      allFootnotesMap.set(fn.footnote_number, {
                        footnote_number: fn.footnote_number,
                        footnote_text: fn.footnote_text,
                        verifications: [],
                        claims: []
                      })
                    })

                    // Add verifications and claims from chunks
                    analysisResult.project_chunks.forEach(chunk => {
                      if (chunk.claims_with_footnotes) {
                        chunk.claims_with_footnotes.forEach(claim => {
                          if (allFootnotesMap.has(claim.footnote_number)) {
                            allFootnotesMap.get(claim.footnote_number)!.claims.push(claim)
                          }
                        })
                      }
                      
                      if (chunk.claim_verifications) {
                        chunk.claim_verifications.forEach(verification => {
                          if (allFootnotesMap.has(verification.footnote_number)) {
                            allFootnotesMap.get(verification.footnote_number)!.verifications.push(verification)
                          }
                        })
                      }
                    })

                    sortedFootnotes = Array.from(allFootnotesMap.values()).sort((a, b) => a.footnote_number - b.footnote_number)
                  } else {
                    // Fallback: collect from chunks only
                    const allFootnotesMap = new Map<number, {
                      footnote_number: number
                      footnote_text: string
                      verifications: ClaimVerification[]
                      claims: ClaimWithFootnote[]
                    }>()

                    analysisResult.project_chunks.forEach(chunk => {
                      if (chunk.claims_with_footnotes) {
                        chunk.claims_with_footnotes.forEach(claim => {
                          if (!allFootnotesMap.has(claim.footnote_number)) {
                            allFootnotesMap.set(claim.footnote_number, {
                              footnote_number: claim.footnote_number,
                              footnote_text: claim.footnote_text,
                              verifications: [],
                              claims: []
                            })
                          }
                          allFootnotesMap.get(claim.footnote_number)!.claims.push(claim)
                        })
                      }
                      
                      if (chunk.claim_verifications) {
                        chunk.claim_verifications.forEach(verification => {
                          if (!allFootnotesMap.has(verification.footnote_number)) {
                            allFootnotesMap.set(verification.footnote_number, {
                              footnote_number: verification.footnote_number,
                              footnote_text: verification.footnote_text,
                              verifications: [],
                              claims: []
                            })
                          }
                          allFootnotesMap.get(verification.footnote_number)!.verifications.push(verification)
                        })
                      }
                    })

                    sortedFootnotes = Array.from(allFootnotesMap.values()).sort((a, b) => a.footnote_number - b.footnote_number)
                  }

                  return sortedFootnotes.map(footnote => {
                    const bestVerification = footnote.verifications.length > 0
                      ? footnote.verifications.reduce((best, v) => 
                          v.verification_score > best.verification_score ? v : best
                        )
                      : null

                    return (
                      <div
                        key={footnote.footnote_number}
                        style={{
                          border: "1px solid #e5e7eb",
                          borderRadius: "8px",
                          padding: "16px",
                          background: bestVerification 
                            ? (bestVerification.verification_score > 0.7 ? "#f0fdf4" : bestVerification.verification_score > 0.5 ? "#fffbeb" : "#fef2f2")
                            : "#f9fafb",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "12px" }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                              <div style={{ 
                                fontSize: "16px", 
                                fontWeight: 700, 
                                color: "#111",
                                minWidth: "60px"
                              }}>
                                Footnote {footnote.footnote_number}
                              </div>
                              {bestVerification && (
                                <div style={{
                                  padding: "4px 8px",
                                  borderRadius: "4px",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  background: getSimilarityColor(bestVerification.verification_score),
                                  color: "#fff"
                                }}>
                                  {(bestVerification.verification_score * 100).toFixed(0)}% Verified
                                </div>
                              )}
                              {!bestVerification && (
                                <div style={{
                                  padding: "4px 8px",
                                  borderRadius: "4px",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  background: "#9ca3af",
                                  color: "#fff"
                                }}>
                                  Not Verified
                                </div>
                              )}
                            </div>
                            
                            <div style={{ fontSize: "13px", color: "#374151", lineHeight: 1.6, marginBottom: "12px" }}>
                              {footnote.footnote_text}
                            </div>

                            {bestVerification && (
                              <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #e5e7eb" }}>
                                <div style={{ fontSize: "12px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                                  Matched Source:
                                </div>
                                <div style={{ fontSize: "13px", color: "#111", fontWeight: 500 }}>
                                  {bestVerification.source_title}
                                </div>
                                <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                                  {bestVerification.source_type} · {bestVerification.supporting_chunks.length} supporting chunk{bestVerification.supporting_chunks.length !== 1 ? "s" : ""}
                                </div>
                                {bestVerification.overall_assessment && (
                                  <div style={{ fontSize: "11px", color: "#374151", marginTop: "6px", fontStyle: "italic" }}>
                                    {bestVerification.overall_assessment}
                                  </div>
                                )}
                              </div>
                            )}

                            {footnote.claims.length > 0 && (
                              <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #e5e7eb" }}>
                                <div style={{ fontSize: "12px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                                  Supporting Claim{footnote.claims.length > 1 ? "s" : ""}:
                                </div>
                                {footnote.claims.map((claim, idx) => (
                                  <div key={idx} style={{ fontSize: "12px", color: "#6b7280", fontStyle: "italic", marginTop: "4px" }}>
                                    "{claim.claim_text.slice(0, 150)}{claim.claim_text.length > 150 ? "..." : ""}"
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {bestVerification && (
                            <div style={{ marginLeft: "16px", textAlign: "right", minWidth: "100px" }}>
                              <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: "4px" }}>
                                Verification Score
                              </div>
                              <div style={{ 
                                fontSize: "24px", 
                                fontWeight: 700, 
                                color: getSimilarityColor(bestVerification.verification_score)
                              }}>
                                {(bestVerification.verification_score * 100).toFixed(0)}%
                              </div>
                              <div style={{ fontSize: "10px", color: "#6b7280", marginTop: "2px" }}>
                                {getSimilarityLabel(bestVerification.verification_score)}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            </div>

            {/* CHUNK-BY-CHUNK ANALYSIS */}
            <div
              style={{
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: "12px",
                padding: "24px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              }}
            >
              <h2 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "20px" }}>
                Chunk-by-Chunk Analysis
              </h2>
              <p style={{ fontSize: "14px", color: "#6b7280", marginBottom: "20px" }}>
                Detailed analysis of each text chunk and its relationship to source documents
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {analysisResult.project_chunks.map(chunk => (
                  <div
                    key={chunk.chunk_index}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                      padding: "16px",
                      background: expandedChunk === chunk.chunk_index ? "#f9fafb" : "#fff",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "12px" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "#6b7280", marginBottom: "4px" }}>
                          Chunk {chunk.chunk_index + 1}
                        </div>
                        <div style={{ fontSize: "14px", lineHeight: 1.6, color: "#111" }}>
                          {chunk.text.slice(0, 200)}
                          {chunk.text.length > 200 && "..."}
                        </div>
                      </div>
                      <div style={{ marginLeft: "16px", textAlign: "right" }}>
                        <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>
                          Max Similarity
                        </div>
                        <div
                          style={{
                            fontSize: "18px",
                            fontWeight: 700,
                            color: getSimilarityColor(chunk.max_similarity),
                          }}
                        >
                          {(chunk.max_similarity * 100).toFixed(1)}%
                        </div>
                        <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                          {getSimilarityLabel(chunk.max_similarity)}
                        </div>
                      </div>
                    </div>

                    {/* CLAIM VERIFICATIONS */}
                    {chunk.claim_verifications && chunk.claim_verifications.length > 0 && (
                      <div style={{ marginBottom: "12px" }}>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "#374151", marginBottom: "8px" }}>
                          📋 Claim Verifications:
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          {chunk.claim_verifications.map((verification, idx) => (
                            <div
                              key={idx}
                              style={{
                                padding: "12px",
                                background: verification.verification_score > 0.7 ? "#f0fdf4" : verification.verification_score > 0.5 ? "#fffbeb" : "#fef2f2",
                                borderRadius: "6px",
                                border: `1px solid ${verification.verification_score > 0.7 ? "#86efac" : verification.verification_score > 0.5 ? "#fde047" : "#fca5a5"}`,
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "6px" }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: "12px", fontWeight: 600, color: "#111", marginBottom: "4px" }}>
                                    Claim (Footnote {verification.footnote_number}):
                                  </div>
                                  <div style={{ fontSize: "13px", color: "#374151", fontStyle: "italic", marginBottom: "6px" }}>
                                    "{verification.claim_text}"
                                  </div>
                                  <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: "4px" }}>
                                    Footnote: "{verification.footnote_text.slice(0, 120)}{verification.footnote_text.length > 120 ? "..." : ""}"
                                  </div>
                                  <div style={{ fontSize: "11px", color: "#6b7280" }}>
                                    Source: <strong>{verification.source_title}</strong> ({verification.source_type})
                                  </div>
                                  {verification.overall_assessment && (
                                    <div style={{ fontSize: "11px", color: "#374151", marginTop: "4px", fontStyle: "italic" }}>
                                      Assessment: {verification.overall_assessment}
                                    </div>
                                  )}
                                </div>
                                <div style={{ marginLeft: "12px", textAlign: "right" }}>
                                  <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: "2px" }}>
                                    Normative Support
                                  </div>
                                  <div
                                    style={{
                                      fontSize: "18px",
                                      fontWeight: 700,
                                      color: getSimilarityColor(verification.verification_score),
                                    }}
                                  >
                                    {(verification.verification_score * 100).toFixed(0)}%
                                  </div>
                                  <div style={{ fontSize: "10px", color: "#6b7280", marginTop: "2px" }}>
                                    {verification.supporting_chunks.length} supporting chunk{verification.supporting_chunks.length !== 1 ? "s" : ""}
                                  </div>
                                </div>
                              </div>
                              
                              {verification.supporting_chunks.length > 0 && (
                                <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid #e5e7eb" }}>
                                  <div style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", marginBottom: "4px" }}>
                                    Supporting Chunks:
                                  </div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                    {verification.supporting_chunks.slice(0, 3).map((supportChunk, sIdx) => (
                                      <div
                                        key={sIdx}
                                        style={{
                                          fontSize: "10px",
                                          color: "#374151",
                                          padding: "6px",
                                          background: "#f9fafb",
                                          borderRadius: "4px",
                                        }}
                                      >
                                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                                          <span>
                                            Page {supportChunk.page_number}
                                          </span>
                                          <span style={{ color: getSimilarityColor(supportChunk.support_score), fontWeight: 600 }}>
                                            {(supportChunk.support_score * 100).toFixed(0)}% support
                                          </span>
                                        </div>
                                        <div style={{ fontStyle: "italic", color: "#6b7280", marginTop: "2px" }}>
                                          "{supportChunk.chunk_text.slice(0, 150)}{supportChunk.chunk_text.length > 150 ? "..." : ""}"
                                        </div>
                                        {supportChunk.reasoning && (
                                          <div style={{ fontSize: "9px", color: "#9ca3af", marginTop: "2px" }}>
                                            {supportChunk.reasoning}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {chunk.matches.length > 0 && (
                      <div>
                        <button
                          onClick={() =>
                            setExpandedChunk(
                              expandedChunk === chunk.chunk_index ? null : chunk.chunk_index
                            )
                          }
                          style={{
                            padding: "6px 12px",
                            background: "none",
                            border: "1px solid #d1d5db",
                            borderRadius: "6px",
                            fontSize: "12px",
                            cursor: "pointer",
                            color: "#374151",
                          }}
                        >
                          {expandedChunk === chunk.chunk_index
                            ? "Hide Matches"
                            : `Show ${chunk.matches.length} Semantic Match${chunk.matches.length !== 1 ? "es" : ""}`}
                        </button>

                        {expandedChunk === chunk.chunk_index && (
                          <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #e5e7eb" }}>
                            <div style={{ fontSize: "12px", fontWeight: 600, color: "#6b7280", marginBottom: "8px" }}>
                              Related Source Chunks:
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                              {chunk.matches.map((match, idx) => (
                                <div
                                  key={`${chunk.chunk_index}-${match.chunk_id}`}
                                  style={{
                                    padding: "10px",
                                    background: "#f9fafb",
                                    borderRadius: "6px",
                                    border: "1px solid #e5e7eb",
                                  }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "6px" }}>
                                    <div>
                                      <div style={{ fontSize: "13px", fontWeight: 500 }}>
                                        {match.source_title}
                                      </div>
                                      <div style={{ fontSize: "11px", color: "#6b7280" }}>
                                        {match.source_type}
                                        {match.page_number && ` · Page ${match.page_number}`}
                                        {match.paragraph_index !== null && ` · Para ${match.paragraph_index}`}
                                      </div>
                                    </div>
                                    <div
                                      style={{
                                        fontSize: "14px",
                                        fontWeight: 600,
                                        color: getSimilarityColor(match.similarity),
                                      }}
                                    >
                                      {(match.similarity * 100).toFixed(1)}%
                                    </div>
                                  </div>
                                  <div
                                    style={{
                                      fontSize: "12px",
                                      color: "#374151",
                                      fontStyle: "italic",
                                      marginTop: "4px",
                                      lineHeight: 1.5,
                                    }}
                                  >
                                    "{match.text.slice(0, 150)}
                                    {match.text.length > 150 && "..."}"
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {chunk.matches.length === 0 && (
                      <div style={{ fontSize: "12px", color: "#9ca3af", fontStyle: "italic" }}>
                        No strong matches found for this chunk
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
