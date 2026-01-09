// =======================================================
// FILE: app/api/reasoning/run/route.ts
// PURPOSE: Deterministic reasoning pipeline with
//          best-effort multi-source coverage + forensic logging
// =======================================================

export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime"
import { buildReasoningPrompt } from "@/lib/reasoning/buildReasoningPrompt"
import crypto from "crypto"

/* ================= ENV / CLIENTS ================= */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "us-east-1",
})

const EMBED_MODEL_ID = "cohere.embed-english-v3"
const GENERATION_INFERENCE_PROFILE_ARN =
  process.env.BEDROCK_INFERENCE_PROFILE_ARN!

/* ================= SINGLE-FLIGHT LOCK ================= */

let generationInFlight = false

/* ================= CONSTANTS ================= */

const MAX_EVIDENCE_CHARS = 50_000

/* ================= TYPES ================= */

type ReasoningRunInput = {
  project_id: string
  query_text: string
  mode?: "generate" | "retrieve"
  word_limit?: number
  approach?: {
    argumentation_line?: {
      id: string
      title: string
      description: string
      approach: string
      focus_areas: string[]
      tone: string
      structure: {
        sections: Array<{
          section_index: number
          title: string
          description: string
        }>
      }
    }
    tone?: string
    structure_type?: string
    focus_areas?: string[]
    sections?: Array<{
      section_index: number
      title: string
      description: string
    }>
  }
}

type EvidenceMeta = {
  source_id: string
  page_number: number
  paragraph_index: number
  excerpt: string
}

type SourceCoverageResult = {
  ok: boolean
  required_count: number
  used_count: number
  missing_source_ids: string[]
}

/* ================= LOGGING ================= */

function log(
  runId: string,
  stage: string,
  data?: any,
  level: "INFO" | "WARN" | "ERROR" = "INFO"
) {
  const payload = {
    ts: new Date().toISOString(),
    runId,
    level,
    stage,
    ...(data !== undefined ? { data } : {}),
  }

  if (level === "ERROR") console.error("🧭", JSON.stringify(payload, null, 2))
  else if (level === "WARN") console.warn("🧭", JSON.stringify(payload, null, 2))
  else console.log("🧭", JSON.stringify(payload, null, 2))
}

/* ================= UTILS ================= */

const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms))

function extractLastCompleteJSONObject(text: string): string | null {
  let depth = 0
  let start = -1

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "{") {
      if (depth === 0) start = i
      depth++
    } else if (ch === "}") {
      depth--
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1)
      }
    }
  }
  return null
}

async function sendWithRetry(cmd: any, runId: string) {
  let attempt = 0
  while (true) {
    try {
      return await bedrock.send(cmd)
    } catch (err: any) {
      if (err?.name === "ThrottlingException" && attempt < 5) {
        attempt++
        const wait = Math.min(2000 * attempt, 10000)
        log(runId, "BEDROCK_THROTTLED", { attempt, wait }, "WARN")
        await sleep(wait)
        continue
      }
      log(runId, "BEDROCK_FATAL", err, "ERROR")
      throw err
    }
  }
}

/* ================= SOURCE COVERAGE (BEST-EFFORT) ================= */

function checkSourceCoverage(
  boundedChunks: any[],
  reasoningOutput: any,
  runId: string
): SourceCoverageResult {
  const requiredSources = new Set<string>(
    boundedChunks.map(c => c.source_id)
  )

  const chunkIdToSource = new Map<string, string>()
  for (const c of boundedChunks) {
    chunkIdToSource.set(c.id, c.source_id)
  }

  const citedSources = new Set<string>()

  for (const section of reasoningOutput.sections ?? []) {
    for (const p of section.paragraphs ?? []) {
      for (const eid of p.evidence_ids ?? []) {
        const sid = chunkIdToSource.get(eid)
        if (sid) citedSources.add(sid)
      }
    }
  }

  const missingSources = [...requiredSources].filter(
    sid => !citedSources.has(sid)
  )

  if (missingSources.length > 0) {
    log(
      runId,
      "VALIDATION_UNUSED_SOURCES",
      {
        missing_source_ids: missingSources,
        required_count: requiredSources.size,
        used_count: citedSources.size,
      },
      "WARN"
    )

    return {
      ok: false,
      required_count: requiredSources.size,
      used_count: citedSources.size,
      missing_source_ids: missingSources,
    }
  }

  log(runId, "VALIDATION_ALL_SOURCES_USED", {
    source_count: requiredSources.size,
  })

  return {
    ok: true,
    required_count: requiredSources.size,
    used_count: citedSources.size,
    missing_source_ids: [],
  }
}

/* ================= HANDLER ================= */

export async function POST(req: Request) {
  const runId = crypto.randomUUID().slice(0, 8)
  log(runId, "REQUEST_START")

  try {
    const body = (await req.json()) as ReasoningRunInput
    let { project_id, query_text, mode = "generate", word_limit, approach } = body

    if (!project_id || !query_text?.trim()) {
      return NextResponse.json(
        { error: "Missing project_id or query_text" },
        { status: 400 }
      )
    }

    // Detect explicit word count requests in query (e.g., "5000 words", "up to 4000 words")
    if (!word_limit) {
      const wordCountMatch = query_text.match(/(?:up to|approximately|about|around|at least|at most|minimum|maximum|max|min)?\s*(\d{1,5})\s*words?/i)
      if (wordCountMatch) {
        const requestedWords = parseInt(wordCountMatch[1], 10)
        if (requestedWords > 0 && requestedWords <= 5000) {
          word_limit = requestedWords
          log(runId, "WORD_LIMIT_DETECTED", { detected_limit: word_limit, from_query: true })
        }
      }
    }

    /* ================= EMBEDDING ================= */

    const embedRes = await bedrock.send(
      new InvokeModelCommand({
        modelId: EMBED_MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          texts: [query_text.slice(0, 2048)],
          input_type: "search_query",
        }),
      })
    )

    const embedJson = JSON.parse(
      Buffer.from(embedRes.body!).toString("utf-8")
    )

    const queryEmbedding = embedJson?.embeddings?.[0]
    if (!queryEmbedding) {
      return NextResponse.json(
        { error: "Embedding failed" },
        { status: 500 }
      )
    }

    /* ================= RETRIEVAL ================= */

    // Retrieve more chunks initially for better selection
    const { data: rawChunks, error } = await supabase.rpc(
      "match_source_chunks",
      {
        query_embedding: queryEmbedding,
        match_project_id: project_id,
        match_count: 150, // Increased from 80 for better selection pool
      }
    )

    if (error) {
      return NextResponse.json(
        { error: "Retrieval failed" },
        { status: 500 }
      )
    }

    log(runId, "RETRIEVAL_COMPLETE", {
      chunks_retrieved: rawChunks?.length || 0,
    })

    if (mode !== "generate") {
      return NextResponse.json({ retrieved_chunks: rawChunks })
    }

    /* ================= SINGLE-FLIGHT ================= */

    if (generationInFlight) {
      return NextResponse.json(
        { error: "Generation already in progress" },
        { status: 429 }
      )
    }

    generationInFlight = true

    try {
      /* ================= LOAD PROJECT & SOURCE CONTEXT ================= */

      const { data: project } = await supabase
        .from("projects")
        .select("project_type, title")
        .eq("id", project_id)
        .single()

      const projectType = project?.project_type || "research_paper"
      log(runId, "PROJECT_CONTEXT", { project_type: projectType, title: project?.title })

      // Load source types for this project
      const { data: sources } = await supabase
        .from("project_sources")
        .select("id, type, title")
        .eq("project_id", project_id)
        .eq("status", "complete")

      const sourceTypes = sources?.map(s => s.type) || []
      const sourceTypeDistribution = sourceTypes.reduce((acc: Record<string, number>, type) => {
        acc[type] = (acc[type] || 0) + 1
        return acc
      }, {})

      log(runId, "SOURCE_CONTEXT", {
        total_sources: sources?.length || 0,
        source_types: sourceTypeDistribution,
        source_details: sources?.map(s => ({ id: s.id, type: s.type, title: s.title }))
      })

      /* ================= ENHANCED CHUNK SELECTION WITH RE-RANKING ================= */

      // Map source IDs to their types
      const sourceIdToType = new Map<string, string>()
      for (const source of sources || []) {
        sourceIdToType.set(source.id, source.type)
      }

      // Score and re-rank chunks using multiple factors
      const scoredChunks = (rawChunks ?? []).map((c: any) => {
        const text = c.text ?? ""
        const sourceType = sourceIdToType.get(c.source_id) || "other"
        
        // Base similarity score (from vector search)
        const similarityScore = c.similarity || 0
        
        // Source type priority - PRIMARY LAW SOURCES get highest priority
        const sourceTypePriority: Record<string, number> = {
          // Primary Law Sources (Highest Priority - Critical for legal arguments)
          case: 1.3,
          statute: 1.4,  // Increased - statutes are essential for black-letter law
          regulation: 1.3,  // Increased - regulations are binding legal rules
          constitution: 1.35,
          treaty: 1.35,  // Increased - treaties/conventions are binding international law
          // Academic / Secondary Sources
          journal_article: 1.1,
          book: 1.05,
          commentary: 1.05,
          working_paper: 1.0,
          thesis: 1.0,
          // Policy / Institutional Sources
          committee_report: 0.95,
          law_commission_report: 0.95,
          white_paper: 0.95,
          government_report: 0.95,
          // Digital / Informal Sources
          blog_post: 0.85,
          news_article: 0.85,
          website: 0.8,
          other: 0.75,
        }
        const typeMultiplier = sourceTypePriority[sourceType] || 0.75
        
        // Length bonus (prefer substantial chunks, but not too long)
        const lengthScore = Math.min(1.0, Math.max(0.7, text.length / 500))
        
        // Keyword matching bonus (simple term frequency)
        const queryTerms = query_text.toLowerCase().split(/\W+/).filter(t => t.length > 3)
        const textLower = text.toLowerCase()
        const keywordMatches = queryTerms.filter(term => textLower.includes(term)).length
        const keywordBonus = Math.min(0.15, (keywordMatches / Math.max(1, queryTerms.length)) * 0.15)
        
        // Position bonus (prefer chunks from earlier pages - often more important)
        const pageBonus = Math.max(0.9, 1.0 - (c.page_number || 0) / 100)
        
        // Combined score
        const finalScore = 
          similarityScore * typeMultiplier * lengthScore * pageBonus + keywordBonus
        
        return {
          ...c,
          content: text,
          source_type: sourceType,
          score: finalScore,
          similarity: similarityScore,
          keyword_matches: keywordMatches,
        }
      })

      // Sort by score
      scoredChunks.sort((a: any, b: any) => b.score - a.score)

      log(runId, "CHUNK_SCORING", {
        top_scores: scoredChunks.slice(0, 10).map((c: any) => ({
          score: c.score.toFixed(3),
          similarity: c.similarity?.toFixed(3),
          source_type: c.source_type,
          keyword_matches: c.keyword_matches,
        })),
      })

      // Select chunks with STRONG diversity enforcement
      let usedChars = 0
      const boundedChunks: any[] = []
      const sourceChunkCounts = new Map<string, number>() // Track chunks per source
      const selectedSourceIds = new Set<string>()
      const selectedSourceTypes = new Set<string>()
      
      // Group chunks by source for balanced selection
      const chunksBySource = new Map<string, typeof scoredChunks>()
      for (const chunk of scoredChunks) {
        if (!chunksBySource.has(chunk.source_id)) {
          chunksBySource.set(chunk.source_id, [])
        }
        chunksBySource.get(chunk.source_id)!.push(chunk)
      }

      // Calculate max chunks per source with aggressive diversity enforcement
      const totalSources = chunksBySource.size
      // Target: use at least 50% of sources, minimum 3, maximum 8
      const targetSources = Math.min(totalSources, Math.max(3, Math.min(8, Math.floor(totalSources * 0.5))))
      // Estimate average chunk size (500 chars) to calculate fair allocation
      const avgChunkSize = 500
      const estimatedChunks = Math.floor(MAX_EVIDENCE_CHARS / avgChunkSize)
      // Fair allocation: divide chunks roughly equally among target sources
      const maxChunksPerSource = Math.max(2, Math.floor(estimatedChunks / targetSources))
      // Hard limit: no single source should get more than 30% of total chunks
      // BUT: Primary law sources (statutes, treaties, regulations) can get up to 40% since they're critical
      const hardMaxPerSource = Math.max(maxChunksPerSource, Math.ceil(estimatedChunks * 0.3))
      
      // Define primary law types once for reuse throughout chunk selection
      const primaryLawTypes = new Set(['statute', 'treaty', 'regulation', 'constitution', 'case'])

      log(runId, "DIVERSITY_CONFIG", {
        total_sources: totalSources,
        target_sources: targetSources,
        estimated_total_chunks: estimatedChunks,
        max_chunks_per_source: maxChunksPerSource,
        hard_max_per_source: hardMaxPerSource,
      })

      // First pass: PRIORITIZE PRIMARY LAW SOURCES - ensure strong representation
      const chunksBySourceType = new Map<string, typeof scoredChunks>()
      for (const chunk of scoredChunks) {
        const type = chunk.source_type
        if (!chunksBySourceType.has(type)) {
          chunksBySourceType.set(type, [])
        }
        chunksBySourceType.get(type)!.push(chunk)
      }

      // PRIORITY 1: Add multiple chunks from primary law sources (statutes, treaties, regulations, constitution, cases)
      // These are critical for legal arguments and must be well-represented
      for (const [sourceType, chunks] of chunksBySourceType.entries()) {
        if (primaryLawTypes.has(sourceType) && chunks.length > 0) {
          // For primary law sources, try to include at least 2-3 chunks if available
          const targetChunks = Math.min(3, chunks.length)
          for (let i = 0; i < targetChunks; i++) {
            const chunk = chunks[i]
            const text = chunk.content
            const sourceId = chunk.source_id
            const currentCount = sourceChunkCounts.get(sourceId) || 0
            
            if (usedChars + text.length <= MAX_EVIDENCE_CHARS && 
                currentCount < hardMaxPerSource &&
                !boundedChunks.some(c => c.id === chunk.id)) {
              boundedChunks.push(chunk)
              usedChars += text.length
              sourceChunkCounts.set(sourceId, currentCount + 1)
              selectedSourceIds.add(sourceId)
              selectedSourceTypes.add(sourceType)
            }
          }
        }
      }

      // PRIORITY 2: Add at least one chunk from each remaining source type (for diversity)
      for (const [sourceType, chunks] of chunksBySourceType.entries()) {
        if (!primaryLawTypes.has(sourceType) && chunks.length > 0) {
          const bestChunk = chunks[0]
          const text = bestChunk.content
          const sourceId = bestChunk.source_id
          const currentCount = sourceChunkCounts.get(sourceId) || 0
          
          if (usedChars + text.length <= MAX_EVIDENCE_CHARS && 
              currentCount < hardMaxPerSource &&
              !boundedChunks.some(c => c.id === bestChunk.id)) {
            boundedChunks.push(bestChunk)
            usedChars += text.length
            sourceChunkCounts.set(sourceId, currentCount + 1)
            selectedSourceIds.add(sourceId)
            selectedSourceTypes.add(sourceType)
          }
        }
      }

      // Second pass: quota-based balanced selection
      // Create a quota for each source (fair share)
      const sourceQuotas = new Map<string, number>()
      const sourceChunkLists = Array.from(chunksBySource.entries())
      
      // Prioritize sources that haven't been selected yet, then by quality
      const unselectedSources = sourceChunkLists.filter(([id]) => !selectedSourceIds.has(id))
      const selectedSources = sourceChunkLists.filter(([id]) => selectedSourceIds.has(id))
      
      // Sort unselected sources by best chunk score
      unselectedSources.sort((a, b) => (b[1][0]?.score || 0) - (a[1][0]?.score || 0))
      // Sort selected sources by best chunk score (for filling remaining quota)
      selectedSources.sort((a, b) => (b[1][0]?.score || 0) - (a[1][0]?.score || 0))
      
      // Allocate quotas: prioritize unselected sources first
      const sourcesToAllocate = [...unselectedSources.slice(0, targetSources), ...selectedSources]
      const sourcesForQuota = sourcesToAllocate.slice(0, targetSources)
      
      for (const [sourceId] of sourcesForQuota) {
        sourceQuotas.set(sourceId, maxChunksPerSource)
      }

      // Round-robin selection: take chunks from sources in rotation until quotas filled
      let sourceIndex = 0
      const maxIterations = estimatedChunks * 3 // Safety limit
      let iterations = 0

      while (usedChars < MAX_EVIDENCE_CHARS && iterations < maxIterations) {
        iterations++
        let addedAny = false

        // Try each source with a quota in rotation
        const sourcesWithQuota = Array.from(sourceQuotas.entries())
        if (sourcesWithQuota.length === 0) break

        for (let i = 0; i < sourcesWithQuota.length; i++) {
          const sourceIdx = (sourceIndex + i) % sourcesWithQuota.length
          const [sourceId, quota] = sourcesWithQuota[sourceIdx]
          const sourceChunks = chunksBySource.get(sourceId) || []
          const currentCount = sourceChunkCounts.get(sourceId) || 0
          
          // Skip if quota filled or hard limit reached
          if (currentCount >= quota || currentCount >= hardMaxPerSource) continue

          // Find best unselected chunk from this source that fits
          for (const chunk of sourceChunks) {
            if (usedChars >= MAX_EVIDENCE_CHARS) break
            if (currentCount >= quota || currentCount >= hardMaxPerSource) break
            
            // Skip if already selected
            if (boundedChunks.some(c => c.id === chunk.id)) continue
            
            const text = chunk.content
            if (usedChars + text.length > MAX_EVIDENCE_CHARS) continue

            // Add chunk (no score filtering here - we're enforcing diversity via quotas)
            boundedChunks.push(chunk)
            usedChars += text.length
            sourceChunkCounts.set(sourceId, currentCount + 1)
            selectedSourceIds.add(sourceId)
            addedAny = true
            break // Move to next source
          }
        }

        sourceIndex = (sourceIndex + 1) % sourcesWithQuota.length

        // If we didn't add anything, break to avoid infinite loop
        if (!addedAny) break
      }

      // Third pass: if we have space left and quotas are filled, fill with best remaining chunks
      // but still respect hard limits per source
      if (usedChars < MAX_EVIDENCE_CHARS * 0.9) { // Only if we used less than 90% of capacity
        const remainingChunks = scoredChunks.filter(
          (c: any) => !boundedChunks.some((bc: any) => bc.id === c.id) && 
               (usedChars + (c.content?.length || 0) <= MAX_EVIDENCE_CHARS) &&
               ((sourceChunkCounts.get(c.source_id) || 0) < hardMaxPerSource)
        )
        
        // Sort remaining by score and add until capacity
        remainingChunks.sort((a: any, b: any) => b.score - a.score)
        for (const chunk of remainingChunks) {
          if (usedChars >= MAX_EVIDENCE_CHARS) break
          
          const sourceId = chunk.source_id
          const currentCount = sourceChunkCounts.get(sourceId) || 0
          if (currentCount >= hardMaxPerSource) continue
          
          const text = chunk.content
          if (usedChars + text.length > MAX_EVIDENCE_CHARS) continue
          
          boundedChunks.push(chunk)
          usedChars += text.length
          sourceChunkCounts.set(sourceId, currentCount + 1)
        }
      }

      // Log final distribution
      const sourceDistribution: Record<string, number> = {}
      for (const [sourceId, count] of sourceChunkCounts.entries()) {
        const sourceType = sourceIdToType.get(sourceId) || "unknown"
        sourceDistribution[sourceType] = (sourceDistribution[sourceType] || 0) + count
      }

      if (!boundedChunks.length) {
        return NextResponse.json(
          { error: "No usable evidence after balancing" },
          { status: 500 }
        )
      }

      /* ================= EXPAND PRIMARY LAW CHUNKS WITH ADJACENT CONTEXT ================= */
      // For statutes, treaties, regulations, and conventions, include adjacent chunks
      // to preserve complete legal provisions and avoid mid-provision cuts
      // Note: primaryLawTypes is already defined above, reusing it here
      const expandedChunks: typeof boundedChunks = []
      const expandedChunkIds = new Set<string>()
      const chunksToExpand = new Set<string>() // Track which chunks need expansion
      
      // Identify primary law chunks that need expansion
      for (const chunk of boundedChunks) {
        const sourceType = sourceIdToType.get(chunk.source_id) || "unknown"
        if (primaryLawTypes.has(sourceType)) {
          chunksToExpand.add(chunk.id)
        }
      }
      
      if (chunksToExpand.size > 0) {
        // Group chunks by source for efficient expansion
        const chunksBySourceForExpansion = new Map<string, typeof boundedChunks>()
        for (const chunk of boundedChunks) {
          if (!chunksBySourceForExpansion.has(chunk.source_id)) {
            chunksBySourceForExpansion.set(chunk.source_id, [])
          }
          chunksBySourceForExpansion.get(chunk.source_id)!.push(chunk)
        }
        
        // For each source with primary law chunks, fetch all chunks to find adjacent ones
        for (const [sourceId, selectedChunks] of chunksBySourceForExpansion.entries()) {
          const sourceType = sourceIdToType.get(sourceId) || "unknown"
          if (!primaryLawTypes.has(sourceType)) {
            // Not a primary law source, add chunks as-is
            for (const chunk of selectedChunks) {
              if (!expandedChunkIds.has(chunk.id)) {
                expandedChunks.push(chunk)
                expandedChunkIds.add(chunk.id)
              }
            }
            continue
          }
          
          // Fetch all chunks from this source, ordered by chunk_index
          const { data: allSourceChunks } = await supabase
            .from("source_chunks")
            .select("id, text, chunk_index, page_number, paragraph_index")
            .eq("source_id", sourceId)
            .order("chunk_index", { ascending: true })
          
          if (!allSourceChunks || allSourceChunks.length === 0) {
            // Fallback: add selected chunks as-is
            for (const chunk of selectedChunks) {
              if (!expandedChunkIds.has(chunk.id)) {
                expandedChunks.push(chunk)
                expandedChunkIds.add(chunk.id)
              }
            }
            continue
          }
          
          // Create a map of chunk_index to chunk for quick lookup
          const chunkIndexMap = new Map<number, any>()
          const chunkIdToIndex = new Map<string, number>()
          for (const c of allSourceChunks) {
            chunkIndexMap.set(c.chunk_index, c)
            chunkIdToIndex.set(c.id, c.chunk_index)
          }
          
          // For each selected chunk, include adjacent chunks (1 before, 1 after)
          const ADJACENT_RANGE = 1 // Include 1 chunk before and 1 after
          for (const selectedChunk of selectedChunks) {
            // Always include the selected chunk itself
            if (!expandedChunkIds.has(selectedChunk.id)) {
              expandedChunks.push(selectedChunk)
              expandedChunkIds.add(selectedChunk.id)
            }
            
            const selectedChunkIndex = chunkIdToIndex.get(selectedChunk.id)
            if (selectedChunkIndex === undefined) {
              // Chunk not found in source, skip expansion
              continue
            }
            
            // Collect adjacent chunks (before and after)
            const startIndex = Math.max(0, selectedChunkIndex - ADJACENT_RANGE)
            const endIndex = Math.min(allSourceChunks.length - 1, selectedChunkIndex + ADJACENT_RANGE)
            
            for (let idx = startIndex; idx <= endIndex; idx++) {
              // Skip the selected chunk itself (already added)
              if (idx === selectedChunkIndex) continue
              
              const adjacentChunk = chunkIndexMap.get(idx)
              if (adjacentChunk && !expandedChunkIds.has(adjacentChunk.id)) {
                // Check if we have space for this chunk
                const adjacentText = adjacentChunk.text || ""
                const additionalChars = adjacentText.length
                
                // Allow some overflow for context (up to 10% over limit)
                if (usedChars + additionalChars <= MAX_EVIDENCE_CHARS * 1.1) {
                  // Find the original chunk data from scoredChunks or rawChunks
                  const originalChunk = scoredChunks.find((c: any) => c.id === adjacentChunk.id) || 
                                       rawChunks?.find((c: any) => c.id === adjacentChunk.id)
                  
                  if (originalChunk) {
                    // Use the original chunk with all its metadata (score, similarity, etc.)
                    expandedChunks.push({
                      ...originalChunk,
                      is_expanded_context: true, // Mark as expanded context
                    })
                  } else {
                    // Fallback: create chunk from database data
                    // Use average similarity/score from selected chunks as fallback
                    const avgSimilarity = selectedChunks.reduce((sum, c) => sum + (c.similarity || 0), 0) / selectedChunks.length
                    const avgScore = selectedChunks.reduce((sum, c) => sum + (c.score || 0), 0) / selectedChunks.length
                    
                    expandedChunks.push({
                      id: adjacentChunk.id,
                      source_id: sourceId,
                      content: adjacentText,
                      text: adjacentText,
                      page_number: adjacentChunk.page_number,
                      paragraph_index: adjacentChunk.paragraph_index,
                      chunk_index: adjacentChunk.chunk_index,
                      source_type: sourceType,
                      similarity: avgSimilarity,
                      score: avgScore,
                      is_expanded_context: true,
                    })
                  }
                  expandedChunkIds.add(adjacentChunk.id)
                  usedChars += additionalChars
                }
              }
            }
          }
        }
        
        // Add any non-primary-law chunks that weren't expanded
        for (const chunk of boundedChunks) {
          const sourceType = sourceIdToType.get(chunk.source_id) || "unknown"
          if (!primaryLawTypes.has(sourceType) && !expandedChunkIds.has(chunk.id)) {
            expandedChunks.push(chunk)
            expandedChunkIds.add(chunk.id)
          }
        }
        
        log(runId, "CHUNK_EXPANSION_COMPLETE", {
          original_chunks: boundedChunks.length,
          expanded_chunks: expandedChunks.length,
          expansion_count: expandedChunks.length - boundedChunks.length,
          primary_law_sources_expanded: Array.from(chunksToExpand).length,
        })
        
        // Replace boundedChunks with expanded chunks
        boundedChunks.length = 0
        boundedChunks.push(...expandedChunks)
      }

      log(runId, "CHUNK_SELECTION_COMPLETE", {
        total_chunks: boundedChunks.length,
        sources_represented: selectedSourceIds.size,
        chars_used: usedChars,
        chars_capacity: MAX_EVIDENCE_CHARS,
        utilization_percent: ((usedChars / MAX_EVIDENCE_CHARS) * 100).toFixed(1),
        chunks_per_source: Object.fromEntries(sourceChunkCounts),
        source_type_distribution: sourceDistribution,
      })

      /* ================= CONTEXT-AWARE PROMPT GENERATION ================= */

      const prompt = buildReasoningPrompt({
        query_text,
        chunks: boundedChunks.map(c => ({
          id: c.id,
          source_id: c.source_id,
          page_number: c.page_number,
          paragraph_index: c.paragraph_index,
          chunk_index: c.chunk_index,
          content: c.content,
        })),
        project_type: projectType,
        approach: approach || undefined,
        source_types: sourceTypeDistribution,
        source_details: sources?.map(s => ({ id: s.id, type: s.type, title: s.title })) || [],
        word_limit: word_limit,
      })

      const genRes = await sendWithRetry(
        new InvokeModelWithResponseStreamCommand({
          modelId: GENERATION_INFERENCE_PROFILE_ARN,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            messages: [
              { role: "user", content: [{ type: "text", text: prompt }] },
            ],
            max_tokens: 30000,
            temperature: 0.2,
          }),
        }),
        runId
      )

      let streamText = ""
      for await (const event of (genRes as any).body) {
        if (!event.chunk?.bytes) continue
        const parsed = JSON.parse(
          Buffer.from(event.chunk.bytes).toString("utf-8")
        )
        if (parsed.type === "content_block_delta") {
          streamText += parsed.delta?.text ?? ""
        }
      }

      const jsonSlice = extractLastCompleteJSONObject(streamText)
      if (!jsonSlice) {
        return NextResponse.json(
          { error: "Model output truncated before JSON completion" },
          { status: 500 }
        )
      }

      const reasoningOutput = JSON.parse(jsonSlice)

      /* ================= HARD STRUCTURAL VALIDATION ================= */

      const validChunkIds = new Set(boundedChunks.map(c => c.id))

      for (const section of reasoningOutput.sections ?? []) {
        for (const p of section.paragraphs ?? []) {
          if (!Array.isArray(p.evidence_ids) || !p.evidence_ids.length) {
            return NextResponse.json(
              { error: "Paragraph without evidence citation" },
              { status: 500 }
            )
          }
          for (const eid of p.evidence_ids) {
            if (!validChunkIds.has(eid)) {
              return NextResponse.json(
                { error: "Model cited unknown evidence ID" },
                { status: 500 }
              )
            }
          }
        }
      }

      /* ================= BEST-EFFORT SOURCE COVERAGE ================= */

      const source_coverage = checkSourceCoverage(
        boundedChunks,
        reasoningOutput,
        runId
      )

      /* ================= EVIDENCE INDEX ================= */

      const evidenceIndex: Record<string, EvidenceMeta> = {}
      for (const c of boundedChunks) {
        evidenceIndex[c.id] = {
          source_id: c.source_id,
          page_number: c.page_number,
          paragraph_index: c.paragraph_index,
          excerpt: c.content.slice(0, 300),
        }
      }

      return NextResponse.json({
        reasoning_output: reasoningOutput,
        evidence_index: evidenceIndex,
        source_coverage,
      })

    } finally {
      generationInFlight = false
      log(runId, "LOCK_RELEASED")
    }

  } catch (err) {
    generationInFlight = false
    log(runId, "FATAL_ERROR", err, "ERROR")
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    )
  }
}
