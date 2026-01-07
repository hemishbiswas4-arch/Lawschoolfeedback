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
  }

  const grouped = groupBySource(retrievedChunks)

  return (
    <div style={{ padding: "80px", maxWidth: "860px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "26px", fontWeight: 700, marginBottom: "12px" }}>
        Research Query
      </h1>

      <p style={{ fontSize: "14px", color: "#6b7280", marginBottom: "24px" }}>
        Retrieve and inspect evidence before generation.
      </p>

      <textarea
        value={query}
        onChange={e => setQuery(e.target.value)}
        rows={6}
        style={{
          width: "100%",
          padding: "12px",
          borderRadius: "8px",
          border: "1px solid #d1d5db",
          fontSize: "14px",
          marginBottom: "12px",
        }}
      />

      <button
        onClick={runRetrieval}
        disabled={loading}
        style={{
          padding: "10px 18px",
          borderRadius: "8px",
          background: "#111",
          color: "#fff",
          fontSize: "14px",
          fontWeight: 500,
        }}
      >
        {loading ? "Retrieving…" : "Retrieve Evidence"}
      </button>

      {/* ================= RESULTS ================= */}

      {grouped.length > 0 && (
        <div style={{ marginTop: "36px" }}>
          {grouped.map(([sourceId, chunks]) => (
            <div
              key={sourceId}
              style={{
                marginBottom: "28px",
                border: "1px solid #e5e7eb",
                borderRadius: "10px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  background: "#f8fafc",
                  padding: "10px 14px",
                  fontSize: "13px",
                  fontWeight: 600,
                  borderBottom: "1px solid #e5e7eb",
                }}
              >
                {sourceTitles[sourceId] ?? sourceId} · {chunks.length} chunk(s)
              </div>

              {chunks.map((chunk, index) => (
                <div
                  key={chunk.id}
                  style={{
                    padding: "14px",
                    borderBottom:
                      index < chunks.length - 1
                        ? "1px solid #f1f5f9"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#475569",
                      marginBottom: "6px",
                    }}
                  >
                    Rank {index + 1}
                    {typeof chunk.similarity === "number" &&
                      ` · score ${chunk.similarity.toFixed(3)}`}
                    {chunk.page_number !== null &&
                      ` · page ${chunk.page_number}`}
                  </div>

                  <div style={{ fontSize: "14px", lineHeight: 1.55 }}>
                    {chunk.text}
                  </div>
                </div>
              ))}
            </div>
          ))}

          <Link
            href={{
              pathname: `/projects/${projectId}/generate`,
              query: { query },
            }}
            style={{
              display: "inline-block",
              marginTop: "8px",
              padding: "10px 18px",
              borderRadius: "8px",
              background: "#0f172a",
              color: "#fff",
              fontSize: "14px",
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Generate Project
          </Link>
        </div>
      )}
    </div>
  )
}
