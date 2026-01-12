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
let generationStartTime: number | null = null
const GENERATION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

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

/* ================= ARGUMENT ANALYSIS ================= */

function analyzeCitationPatterns(chunks: any[]): Map<string, string[]> {
  const citationMap = new Map<string, string[]>()

  // Legal citation patterns to detect cross-references
  const legalCitationRegex = /\b\d{4}\b.*?\b\d{4}\b|See\s.*?(\d{4})|v\.|Cf\.|Id\.|Supra|Infra/gi

  for (const chunk of chunks) {
    const citations: string[] = []
    const text = chunk.text?.toLowerCase() || ""

    // Check for legal citation patterns
    if (legalCitationRegex.test(text)) {
      citations.push("legal_citation")
    }

    // Check for cross-references within the same document
    const crossRefPatterns = [
      /see\s+(?:section|article|paragraph)\s+\d+/gi,
      /pursuant\s+to\s+(?:section|article)/gi,
      /in\s+accordance\s+with/gi,
      /subject\s+to/gi,
      /notwithstanding/gi,
      /provided\s+that/gi,
    ]

    for (const pattern of crossRefPatterns) {
      if (pattern.test(text)) {
        citations.push("cross_reference")
        break
      }
    }

    // Check for argumentative connectors
    const argumentConnectors = [
      /however/gi,
      /moreover/gi,
      /furthermore/gi,
      /consequently/gi,
      /therefore/gi,
      /thus/gi,
      /accordingly/gi,
      /nevertheless/gi,
      /notwithstanding/gi,
      /whereas/gi,
    ]

    for (const connector of argumentConnectors) {
      if (connector.test(text)) {
        citations.push("argument_connector")
        break
      }
    }

    citationMap.set(chunk.id, citations)
  }

  return citationMap
}

function identifyArgumentGroups(chunks: any[], citationPatterns: Map<string, string[]>): Map<string, string[]> {
  const argumentGroups = new Map<string, string[]>()

  // Group chunks by source to identify coherent arguments within documents
  const chunksBySource = new Map<string, typeof chunks>()
  for (const chunk of chunks) {
    if (!chunksBySource.has(chunk.source_id)) {
      chunksBySource.set(chunk.source_id, [])
    }
    chunksBySource.get(chunk.source_id)!.push(chunk)
  }

  // Sort chunks within each source by chunk_index for sequential analysis
  for (const [sourceId, sourceChunks] of chunksBySource.entries()) {
    sourceChunks.sort((a, b) => (a.chunk_index || 0) - (b.chunk_index || 0))

    // Identify argument units: sequences of chunks that form coherent arguments
    let currentGroup: string[] = []
    let groupId = `${sourceId}_arg_0`

    for (let i = 0; i < sourceChunks.length; i++) {
      const chunk = sourceChunks[i]
      const patterns = citationPatterns.get(chunk.id) || []

      // Start new group if this chunk has strong argumentative markers
      if (patterns.includes("argument_connector") ||
          patterns.includes("cross_reference") ||
          i === 0) {
        if (currentGroup.length > 0) {
          argumentGroups.set(groupId, [...currentGroup])
          groupId = `${sourceId}_arg_${argumentGroups.size}`
          currentGroup = []
        }
      }

      currentGroup.push(chunk.id)

      // Also check if next chunk continues the argument
      if (i < sourceChunks.length - 1) {
        const nextChunk = sourceChunks[i + 1]
        const nextPatterns = citationPatterns.get(nextChunk.id) || []

        // Continue group if chunks are closely related or sequential
        const chunkGap = (nextChunk.chunk_index || 0) - (chunk.chunk_index || 0)
        if (chunkGap <= 3 && (patterns.includes("cross_reference") || nextPatterns.includes("argument_connector"))) {
          // Continue current group
        } else if (chunkGap > 5) {
          // Large gap suggests new argument unit
          argumentGroups.set(groupId, [...currentGroup])
          groupId = `${sourceId}_arg_${argumentGroups.size}`
          currentGroup = []
        }
      }
    }

    // Add final group
    if (currentGroup.length > 0) {
      argumentGroups.set(groupId, currentGroup)
    }
  }

  return argumentGroups
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

/* ================= COMPREHENSIVE SOURCE COVERAGE & CITATION QUALITY ================= */

function checkSourceCoverage(
  boundedChunks: any[],
  reasoningOutput: any,
  runId: string
): SourceCoverageResult & { quality_score: number; coverage_details: any } {
  const requiredSources = new Set<string>(
    boundedChunks.map(c => c.source_id)
  )

  const chunkIdToSource = new Map<string, string>()
  const chunkIdToType = new Map<string, string>()
  for (const c of boundedChunks) {
    chunkIdToSource.set(c.id, c.source_id)
    chunkIdToType.set(c.id, c.source_type || "unknown")
  }

  // Analyze citation usage and quality
  const sourceCitationStats = new Map<string, {
    citations: number
    direct_quotes: number
    substantial_uses: number
    references: number
    total_chunks: number
    type: string
  }>()

  // Initialize stats for all sources
  for (const sourceId of requiredSources) {
    const sourceType = Array.from(chunkIdToType.entries()).find(([chunkId]) =>
      chunkIdToSource.get(chunkId) === sourceId
    )?.[1] || "unknown"

    sourceCitationStats.set(sourceId, {
      citations: 0,
      direct_quotes: 0,
      substantial_uses: 0,
      references: 0,
      total_chunks: boundedChunks.filter(c => c.source_id === sourceId).length,
      type: sourceType
    })
  }

  const citedSources = new Set<string>()
  let totalCitations = 0
  let rawQualityScore = 0

  for (const section of reasoningOutput.sections ?? []) {
    for (const p of section.paragraphs ?? []) {
      for (const citation of p.citations ?? []) {
        const sid = chunkIdToSource.get(citation.evidence_id)
        if (sid) {
          citedSources.add(sid)
          const stats = sourceCitationStats.get(sid)!
          stats.citations++

          // Score citation quality
          switch (citation.usage_type) {
            case "direct":
              stats.direct_quotes++
              rawQualityScore += 3 // Highest quality - direct quotes
              break
            case "substantial":
              stats.substantial_uses++
              rawQualityScore += 2 // Good quality - substantial use
              break
            case "reference":
              stats.references++
              rawQualityScore += 1 // Basic quality - general reference
              break
          }
          totalCitations++
        }
      }
    }
  }

  // Calculate coverage quality metrics
  const missingSources = [...requiredSources].filter(
    sid => !citedSources.has(sid)
  )

  // Source type balance scoring
  const primaryLawTypes = new Set(['statute', 'treaty', 'regulation', 'constitution', 'case'])
  let primaryLawCoverage = 0
  let totalPrimaryLawSources = 0

  for (const [sourceId, stats] of sourceCitationStats) {
    if (primaryLawTypes.has(stats.type)) {
      totalPrimaryLawSources++
      if (citedSources.has(sourceId)) {
        primaryLawCoverage++
      }
    }
  }

  // Overall quality score (0-100)
  const coverageRatio = citedSources.size / requiredSources.size
  const primaryLawRatio = totalPrimaryLawSources > 0 ? primaryLawCoverage / totalPrimaryLawSources : 1
  const citationDensity = totalCitations / (reasoningOutput.sections?.length || 1)

  const finalQualityScore = Math.min(100, Math.round(
    (coverageRatio * 40) + // 40% weight on coverage
    (primaryLawRatio * 30) + // 30% weight on primary law coverage
    (Math.min(citationDensity / 10, 1) * 20) + // 20% weight on citation density (max 10 citations per section)
    (totalCitations > 0 ? Math.min(rawQualityScore / totalCitations, 2) * 10 : 0) // 10% weight on citation quality (direct quotes preferred)
  ))

  const coverageDetails = {
    source_stats: Array.from(sourceCitationStats.entries()).map(([sourceId, stats]) => ({
      source_id: sourceId,
      type: stats.type,
      total_chunks: stats.total_chunks,
      citations: stats.citations,
      direct_quotes: stats.direct_quotes,
      substantial_uses: stats.substantial_uses,
      references: stats.references,
      citation_rate: stats.total_chunks > 0 ? stats.citations / stats.total_chunks : 0
    })),
    primary_law_coverage: `${primaryLawCoverage}/${totalPrimaryLawSources}`,
    citation_density: citationDensity.toFixed(2),
    quality_breakdown: {
      coverage_score: Math.round(coverageRatio * 40),
      primary_law_score: Math.round(primaryLawRatio * 30),
      density_score: Math.round(Math.min(citationDensity / 10, 1) * 20),
      quality_score_component: Math.round(totalCitations > 0 ? Math.min(rawQualityScore / totalCitations, 2) * 10 : 0)
    }
  }

  if (missingSources.length > 0) {
    log(
      runId,
      "VALIDATION_UNUSED_SOURCES",
      {
        missing_source_ids: missingSources,
        required_count: requiredSources.size,
        used_count: citedSources.size,
        quality_score: finalQualityScore,
        coverage_details: coverageDetails
      },
      "WARN"
    )

    return {
      ok: false,
      required_count: requiredSources.size,
      used_count: citedSources.size,
      missing_source_ids: missingSources,
      quality_score: finalQualityScore,
      coverage_details: coverageDetails
    }
  }

  log(runId, "VALIDATION_COMPREHENSIVE_COVERAGE", {
    source_count: requiredSources.size,
        quality_score: finalQualityScore,
        coverage_details: coverageDetails
  })

  return {
    ok: true,
    required_count: requiredSources.size,
    used_count: citedSources.size,
    missing_source_ids: [],
        quality_score: finalQualityScore,
        coverage_details: coverageDetails
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
      const now = Date.now()
      const elapsed = generationStartTime ? now - generationStartTime : 0

      // If generation has been running for more than 5 minutes, allow new requests
      if (elapsed > GENERATION_TIMEOUT_MS) {
        console.log(`GENERATION [${runId}] Previous generation timed out (${elapsed}ms), allowing new request`)
        generationInFlight = false
        generationStartTime = null
      } else {
        // Return error message asking user to try again later
        console.log(`GENERATION [${runId}] Generation busy (${elapsed}ms elapsed), returning error`)
        return NextResponse.json(
          { error: "Generation is currently in progress. Please try again in 5 minutes." },
          { status: 429 }
        )
      }
    }

    generationInFlight = true
    generationStartTime = Date.now()

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

      /* ================= ARGUMENT-AWARE CHUNK SELECTION ================= */

      // Map source IDs to their types
      const sourceIdToType = new Map<string, string>()
      for (const source of sources || []) {
        sourceIdToType.set(source.id, source.type)
      }

      // First pass: Analyze citation patterns and argument coherence
      const citationPatterns = analyzeCitationPatterns(rawChunks ?? [])
      const argumentGroups = identifyArgumentGroups(rawChunks ?? [], citationPatterns)

      // Score and re-rank chunks using multiple factors including argument coherence
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

        // Argument coherence bonus - boost chunks that are part of coherent argument groups
        let argumentCoherenceBonus = 0
        for (const [groupId, chunkIds] of argumentGroups.entries()) {
          if (chunkIds.includes(c.id)) {
            // Boost chunks in larger argument groups
            const groupSize = chunkIds.length
            argumentCoherenceBonus = Math.min(0.2, groupSize * 0.05) // Up to 20% bonus for large coherent groups

            // Additional boost if this is a central chunk in the group
            const chunkIndex = chunkIds.indexOf(c.id)
            if (chunkIndex >= 0 && chunkIndex < chunkIds.length / 2) {
              argumentCoherenceBonus += 0.05 // Early chunks in arguments often more important
            }
            break
          }
        }

        // Citation pattern bonus
        const patterns = citationPatterns.get(c.id) || []
        const citationBonus = patterns.length * 0.02 // Small bonus for each citation pattern

        // Combined score
        const finalScore =
          similarityScore * typeMultiplier * lengthScore * pageBonus + keywordBonus + argumentCoherenceBonus + citationBonus

        return {
          ...c,
          content: text,
          source_type: sourceType,
          score: finalScore,
          similarity: similarityScore,
          keyword_matches: keywordMatches,
          argument_coherence_bonus: argumentCoherenceBonus,
          citation_bonus: citationBonus,
        }
      })

      // Sort by score
      scoredChunks.sort((a: any, b: any) => b.score - a.score)

      log(runId, "CHUNK_SCORING", {
        argument_groups_identified: argumentGroups.size.toString(),
        citation_patterns_found: Array.from(citationPatterns.values()).flat().length.toString(),
        top_scores: scoredChunks.slice(0, 10).map((c: any) => ({
          score: c.score.toFixed(3),
          similarity: c.similarity?.toFixed(3),
          source_type: c.source_type,
          keyword_matches: c.keyword_matches,
          argument_coherence: c.argument_coherence_bonus?.toFixed(3),
          citation_patterns: citationPatterns.get(c.id)?.length || 0,
        })),
      })

      // Select chunks with ARGUMENT-AWARE diversity enforcement
      let usedChars = 0
      const boundedChunks: any[] = []
      const sourceChunkCounts = new Map<string, number>() // Track chunks per source
      const selectedSourceIds = new Set<string>()
      const selectedSourceTypes = new Set<string>()
      const selectedArgumentGroups = new Set<string>() // Track selected argument groups
      
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
      // Group sources by type, then select from different sources within each type
      const sourcesByType = new Map<string, Array<{ sourceId: string; chunks: typeof scoredChunks }>>()
      
      for (const [sourceId, sourceChunks] of chunksBySource.entries()) {
        const sourceType = sourceIdToType.get(sourceId) || "unknown"
        if (!sourcesByType.has(sourceType)) {
          sourcesByType.set(sourceType, [])
        }
        // Sort chunks by score within each source
        const sortedChunks = [...sourceChunks].sort((a, b) => b.score - a.score)
        sourcesByType.get(sourceType)!.push({ sourceId, chunks: sortedChunks })
      }

      // PRIORITY 1: Add chunks from primary law sources, prioritizing complete argument groups
      // These are critical for legal arguments and must be well-represented
      for (const [sourceType, sources] of sourcesByType.entries()) {
        if (primaryLawTypes.has(sourceType) && sources.length > 0) {
          // Sort sources by their best chunk score to prioritize quality sources
          sources.sort((a, b) => (b.chunks[0]?.score || 0) - (a.chunks[0]?.score || 0))

          for (const { sourceId, chunks } of sources) {
            const currentCount = sourceChunkCounts.get(sourceId) || 0
            if (currentCount >= hardMaxPerSource) continue

            // First, try to add complete argument groups from this source
            let groupAdded = false
            for (const [groupId, chunkIds] of argumentGroups.entries()) {
              if (groupId.startsWith(`${sourceId}_arg_`) && !selectedArgumentGroups.has(groupId)) {
                const groupChunks = chunkIds
                  .map((id: string) => chunks.find((c: any) => c.id === id))
                  .filter((c: any) => c !== undefined)

                if (groupChunks.length >= 2) { // Only consider groups with multiple chunks
                  const groupTextLength = groupChunks.reduce((sum, c) => sum + (c.content?.length || 0), 0)

                  if (usedChars + groupTextLength <= MAX_EVIDENCE_CHARS &&
                      currentCount + groupChunks.length <= hardMaxPerSource) {
                    // Add the entire argument group
                    for (const chunk of groupChunks) {
                      if (!boundedChunks.some(c => c.id === chunk.id)) {
                        boundedChunks.push(chunk)
                        usedChars += chunk.content?.length || 0
                        sourceChunkCounts.set(sourceId, (sourceChunkCounts.get(sourceId) || 0) + 1)
                        selectedSourceIds.add(sourceId)
                        selectedSourceTypes.add(sourceType)
                      }
                    }
                    selectedArgumentGroups.add(groupId)
                    groupAdded = true
                    break // Move to next source
                  }
                }
              }
            }

            // If no complete group was added, fall back to individual chunks
            if (!groupAdded) {
              // Add 1-2 best chunks from this source
              const targetChunks = Math.min(2, chunks.length)
              for (let i = 0; i < targetChunks; i++) {
                const chunk = chunks[i]
                const text = chunk.content

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
        }
      }

      // PRIORITY 2: Add at least one chunk from each remaining source (ensuring source diversity)
      for (const [sourceType, sources] of sourcesByType.entries()) {
        if (!primaryLawTypes.has(sourceType) && sources.length > 0) {
          // Sort sources by their best chunk score
          sources.sort((a, b) => (b.chunks[0]?.score || 0) - (a.chunks[0]?.score || 0))
          
          // Add best chunk from each source (one per source for diversity)
          for (const { sourceId, chunks } of sources) {
            if (chunks.length === 0) continue
            const bestChunk = chunks[0]
            const text = bestChunk.content
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
      const chunkContentMap = new Map<string, string>()
      for (const c of boundedChunks) {
        chunkContentMap.set(c.id, c.content)
      }

      for (const section of reasoningOutput.sections ?? []) {
        for (const p of section.paragraphs ?? []) {
          if (!Array.isArray(p.evidence_ids) || !p.evidence_ids.length) {
            return NextResponse.json(
              { error: "Paragraph without evidence citation" },
              { status: 500 }
            )
          }
          
          // Validate evidence_ids
          for (const eid of p.evidence_ids) {
            if (!validChunkIds.has(eid)) {
              return NextResponse.json(
                { error: "Model cited unknown evidence ID" },
                { status: 500 }
              )
            }
          }
          
          // Validate citations if provided
          if (p.citations && Array.isArray(p.citations)) {
            const citedEvidenceIds = new Set(p.evidence_ids)
            
            for (const citation of p.citations) {
              // Validate citation structure
              if (!citation.evidence_id || !validChunkIds.has(citation.evidence_id)) {
                return NextResponse.json(
                  { error: "Citation references invalid evidence ID" },
                  { status: 500 }
                )
              }
              
              // Validate usage_type
              if (!['direct', 'substantial', 'reference'].includes(citation.usage_type)) {
                return NextResponse.json(
                  { error: "Invalid usage_type in citation" },
                  { status: 500 }
                )
              }
              
              // Validate character positions if provided
              if (citation.char_start !== undefined && citation.char_end !== undefined) {
                const chunkContent = chunkContentMap.get(citation.evidence_id) || ""
                if (citation.char_start < 0 || citation.char_end > chunkContent.length || citation.char_start > citation.char_end) {
                  log(runId, "CITATION_POSITION_WARNING", {
                    evidence_id: citation.evidence_id,
                    char_start: citation.char_start,
                    char_end: citation.char_end,
                    chunk_length: chunkContent.length,
                  }, "WARN")
                  // Don't fail, just log warning - positions might be approximate
                }
              }
              
              // Validate quoted_text for direct quotes
              if (citation.usage_type === 'direct' && !citation.quoted_text) {
                log(runId, "MISSING_QUOTED_TEXT", {
                  evidence_id: citation.evidence_id,
                }, "WARN")
                // Don't fail, but log warning
              }
            }
            
            // Ensure all evidence_ids have at least one citation (best-effort)
            for (const eid of p.evidence_ids) {
              const hasCitation = p.citations.some((c: any) => c.evidence_id === eid)
              if (!hasCitation) {
                log(runId, "MISSING_CITATION_FOR_EVIDENCE", {
                  evidence_id: eid,
                  paragraph_index: p.paragraph_index,
                }, "WARN")
                // Auto-create a reference citation if missing
                if (!p.citations) p.citations = []
                p.citations.push({
                  evidence_id: eid,
                  usage_type: "reference",
                  char_start: 0,
                  char_end: Math.min(100, chunkContentMap.get(eid)?.length || 0),
                })
              }
            }
          } else {
            // If citations array is missing, create default citations for all evidence_ids
            p.citations = p.evidence_ids.map((eid: string) => ({
              evidence_id: eid,
              usage_type: "reference" as const,
              char_start: 0,
              char_end: Math.min(100, chunkContentMap.get(eid)?.length || 0),
            }))
          }
        }
      }

      /* ================= COMPREHENSIVE SOURCE COVERAGE & QUALITY ================= */

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
        citation_quality_score: source_coverage.quality_score,
        coverage_analysis: source_coverage.coverage_details,
      })

    } finally {
      generationInFlight = false
      generationStartTime = null
      log(runId, "LOCK_RELEASED")
    }

  } catch (err) {
    generationInFlight = false
    generationStartTime = null
    log(runId, "FATAL_ERROR", err, "ERROR")
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    )
  }
}
