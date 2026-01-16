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

/* ================= PER-USER SINGLE-FLIGHT LOCK ================= */

// Track generation state per user (user_id -> { inFlight: boolean, startTime: number | null })
const userGenerationLocks = new Map<string, { inFlight: boolean; startTime: number | null }>()
const GENERATION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

/* ================= CONDITIONAL QUEUE SYSTEM (ACTIVATES ON THROTTLING) ================= */

import {
  generationQueue,
  generationQueueProcessing,
  setGenerationQueueProcessing,
  setGenerationThrottlingDetected,
  getGenerationQueueStatus,
  type QueuedGenerationRequest,
} from "@/lib/queueState"

const THROTTLING_COOLDOWN_MS = 2 * 60 * 1000 // 2 minutes before switching back to parallel mode

// Use shared throttling state
const throttlingDetected = () => getGenerationQueueStatus("").queue_mode_active
const throttlingDetectedAt = () => {
  // We'll track this in the shared module
  return null // Will be managed by shared module
}

/* ================= CONSTANTS ================= */

const MAX_EVIDENCE_CHARS = 50_000

/* ================= MMR (MAXIMAL MARGINAL RELEVANCE) ================= */

// Tokenize text for similarity computation
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 2)
  )
}

// Compute Jaccard similarity between two texts (0-1)
function computeTextSimilarity(textA: string, textB: string): number {
  const tokensA = tokenize(textA)
  const tokensB = tokenize(textB)
  
  if (tokensA.size === 0 || tokensB.size === 0) return 0
  
  let intersection = 0
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++
  }
  
  const union = tokensA.size + tokensB.size - intersection
  return union > 0 ? intersection / union : 0
}

// MMR chunk selection that balances relevance with diversity
type ScoredChunk = {
  id: string
  source_id: string
  content: string
  score: number
  similarity: number
  source_type: string
  [key: string]: any
}

function selectChunksWithMMR(
  chunks: ScoredChunk[],
  targetCharCount: number,
  lambda: number = 0.7,  // 0.7 relevance, 0.3 diversity
  maxPerSource: number = 10,
  runId?: string
): { selected: ScoredChunk[], usedChars: number } {
  const selected: ScoredChunk[] = []
  const remaining = [...chunks]
  const sourceChunkCounts = new Map<string, number>()
  let usedChars = 0
  
  // Precompute max similarity scores to speed up MMR
  const selectedTexts: string[] = []
  
  while (remaining.length > 0 && usedChars < targetCharCount) {
    let bestIdx = -1
    let bestMMRScore = -Infinity
    
    for (let i = 0; i < remaining.length; i++) {
      const chunk = remaining[i]
      const chunkText = chunk.content || ""
      const chunkLength = chunkText.length
      
      // Skip if adding this chunk would exceed char limit
      if (usedChars + chunkLength > targetCharCount) continue
      
      // Skip if source already has max chunks
      const sourceCount = sourceChunkCounts.get(chunk.source_id) || 0
      if (sourceCount >= maxPerSource) continue
      
      // Compute relevance (normalized score)
      const relevance = chunk.score
      
      // Compute max similarity to already selected chunks
      let maxSimToSelected = 0
      if (selectedTexts.length > 0) {
        for (const selectedText of selectedTexts) {
          const sim = computeTextSimilarity(chunkText, selectedText)
          if (sim > maxSimToSelected) {
            maxSimToSelected = sim
          }
        }
      }
      
      // MMR score: λ * relevance - (1-λ) * max_similarity_to_selected
      const mmrScore = lambda * relevance - (1 - lambda) * maxSimToSelected
      
      // Apply source diversity bonus for underrepresented sources
      const sourceDiversityBonus = sourceCount === 0 ? 0.1 : (sourceCount < 3 ? 0.05 : 0)
      const finalMMRScore = mmrScore + sourceDiversityBonus
      
      if (finalMMRScore > bestMMRScore) {
        bestMMRScore = finalMMRScore
        bestIdx = i
      }
    }
    
    // No valid chunk found
    if (bestIdx === -1) break
    
    // Add the best chunk
    const bestChunk = remaining.splice(bestIdx, 1)[0]
    selected.push(bestChunk)
    selectedTexts.push(bestChunk.content || "")
    usedChars += (bestChunk.content || "").length
    sourceChunkCounts.set(
      bestChunk.source_id,
      (sourceChunkCounts.get(bestChunk.source_id) || 0) + 1
    )
  }
  
  if (runId) {
    const sourceDistribution: Record<string, number> = {}
    for (const [sourceId, count] of sourceChunkCounts.entries()) {
      const sourceType = selected.find(c => c.source_id === sourceId)?.source_type || "unknown"
      sourceDistribution[sourceType] = (sourceDistribution[sourceType] || 0) + count
    }
    
    log(runId, "MMR_SELECTION_COMPLETE", {
      total_selected: selected.length,
      sources_represented: sourceChunkCounts.size,
      chars_used: usedChars,
      lambda: lambda,
      source_distribution: sourceDistribution,
    })
  }
  
  return { selected, usedChars }
}

/* ================= ARGUMENT-BASED CHUNK RE-RANKING ================= */

type ArgumentationLine = {
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

// Compute semantic overlap between text and a term
function hasSemanticOverlap(text: string, term: string): boolean {
  const textLower = text.toLowerCase()
  const termLower = term.toLowerCase()
  
  // Direct match
  if (textLower.includes(termLower)) return true
  
  // Check for word overlap (at least 2 words)
  const termWords = termLower.split(/\s+/).filter(w => w.length > 3)
  const matchingWords = termWords.filter(w => textLower.includes(w))
  return matchingWords.length >= Math.min(2, termWords.length)
}

// Re-rank chunks based on selected argumentation line(s)
function rerankChunksForArgument(
  chunks: ScoredChunk[],
  argument: ArgumentationLine | ArgumentationLine[],
  runId?: string
): ScoredChunk[] {
  // Handle combined arguments: merge focus areas and sections
  const args = Array.isArray(argument) ? argument : [argument]
  
  const allFocusAreas: string[] = []
  const allSectionTopics: string[] = []
  const allApproaches: string[] = []
  
  for (const arg of args) {
    // Extract focus area terms
    if (arg.focus_areas) {
      for (const area of arg.focus_areas) {
        allFocusAreas.push(...area.toLowerCase().split(/\s+/).filter(w => w.length > 3))
      }
    }
    
    // Extract section topics
    if (arg.structure?.sections) {
      for (const section of arg.structure.sections) {
        allSectionTopics.push(section.title.toLowerCase())
        if (section.description) {
          allSectionTopics.push(section.description.toLowerCase())
        }
      }
    }
    
    // Extract approach terms
    if (arg.approach) {
      allApproaches.push(...arg.approach.toLowerCase().split(/\s+/).filter(w => w.length > 3))
    }
    
    // Extract title/description terms
    if (arg.title) {
      allFocusAreas.push(...arg.title.toLowerCase().split(/\s+/).filter(w => w.length > 3))
    }
    if (arg.description) {
      allFocusAreas.push(...arg.description.toLowerCase().split(/\s+/).filter(w => w.length > 4))
    }
  }
  
  // Deduplicate terms
  const focusTerms = [...new Set(allFocusAreas)]
  const sectionTopics = [...new Set(allSectionTopics)]
  const approachTerms = [...new Set(allApproaches)]
  
  if (runId) {
    log(runId, "ARGUMENT_RERANKING_START", {
      argument_count: args.length,
      focus_terms_count: focusTerms.length,
      section_topics_count: sectionTopics.length,
      approach_terms_count: approachTerms.length,
      sample_focus_terms: focusTerms.slice(0, 10),
      sample_section_topics: sectionTopics.slice(0, 5),
    })
  }
  
  // Re-rank chunks based on argument alignment
  const rerankedChunks = chunks.map(chunk => {
    const text = (chunk.content || "").toLowerCase()
    
    // Boost for focus area matches
    const focusMatches = focusTerms.filter(t => text.includes(t)).length
    const focusBoost = Math.min(0.3, (focusMatches / Math.max(1, focusTerms.length)) * 0.3)
    
    // Boost for section topic alignment
    let sectionBoost = 0
    for (const topic of sectionTopics) {
      if (hasSemanticOverlap(text, topic)) {
        sectionBoost += 0.1
        break // Only count once per topic
      }
    }
    sectionBoost = Math.min(0.25, sectionBoost)
    
    // Boost for approach alignment
    const approachMatches = approachTerms.filter(t => text.includes(t)).length
    const approachBoost = Math.min(0.15, (approachMatches / Math.max(1, approachTerms.length)) * 0.15)
    
    // Calculate total argument alignment
    const argumentAlignment = focusBoost + sectionBoost + approachBoost
    
    return {
      ...chunk,
      score: chunk.score + argumentAlignment,
      argument_alignment: argumentAlignment,
      focus_matches: focusMatches,
      section_alignment: sectionBoost > 0,
    }
  })
  
  // Sort by new score
  rerankedChunks.sort((a, b) => b.score - a.score)
  
  if (runId) {
    const topAligned = rerankedChunks.slice(0, 10).filter(c => c.argument_alignment > 0)
    log(runId, "ARGUMENT_RERANKING_COMPLETE", {
      chunks_with_alignment: rerankedChunks.filter(c => c.argument_alignment > 0).length,
      top_alignment_scores: topAligned.map(c => ({
        score: c.score.toFixed(3),
        alignment: c.argument_alignment.toFixed(3),
        focus_matches: c.focus_matches,
      })),
    })
  }
  
  return rerankedChunks
}

/* ================= TYPES ================= */

type ReasoningRunInput = {
  project_id: string
  query_text: string
  mode?: "generate" | "retrieve"
  word_limit?: number
  user_id?: string
  user_email?: string
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
        
        // Activate queue system if throttling persists
        if (attempt >= 3) {
          const currentStatus = getGenerationQueueStatus("")
          if (!currentStatus.queue_mode_active) {
            setGenerationThrottlingDetected(true, Date.now())
            log(runId, "THROTTLING_DETECTED_QUEUE_ACTIVATED", { attempt }, "WARN")
          }
        }
        
        await sleep(wait)
        continue
      }
      log(runId, "BEDROCK_FATAL", err, "ERROR")
      throw err
    }
  }
}

/* ================= QUEUE PROCESSING ================= */

async function processGenerationQueue() {
  if (generationQueueProcessing() || generationQueue.length === 0) return
  
  setGenerationQueueProcessing(true)
  log("QUEUE", "PROCESSING_START", { queue_length: generationQueue.length })
  
  while (generationQueue.length > 0) {
    const request = generationQueue.shift()
    if (!request) break
    
    try {
      log(request.runId, "QUEUE_PROCESSING", { user_id: request.user_id, queue_position: generationQueue.length })
      
      // Check user lock before processing
      const userLock = userGenerationLocks.get(request.user_id)
      if (userLock?.inFlight) {
        // User already has a request in progress, skip this one
        log(request.runId, "QUEUE_SKIP_USER_BUSY", { user_id: request.user_id })
        request.reject(new Error("You already have a generation in progress"))
        continue
      }
      
      // Acquire lock for this user
      userGenerationLocks.set(request.user_id, { inFlight: true, startTime: Date.now() })
      
      try {
        // Process the queued request using the extracted generation function
        const result = await processQueuedGenerationRequest(request)
        request.resolve(NextResponse.json(result))
      } finally {
        // Release lock for this user
        userGenerationLocks.set(request.user_id, { inFlight: false, startTime: null })
      }
    } catch (error: any) {
      log(request.runId, "QUEUE_ERROR", { error: error?.message || error }, "ERROR")
      request.reject(error)
      // Release lock on error
      userGenerationLocks.set(request.user_id, { inFlight: false, startTime: null })
    }
    
    // Small delay between queue items to prevent overwhelming the API
    // Longer delay when throttling was recently detected
    const delay = throttlingDetected() ? 3000 : 1000
    await sleep(delay)
  }
  
  setGenerationQueueProcessing(false)
  
  // Check if we should deactivate queue mode
  const currentStatus = getGenerationQueueStatus("")
  if (currentStatus.queue_mode_active) {
    // Get throttling timestamp from shared state - we'll need to track this
    // For now, check if queue is empty and enough time has passed
    if (generationQueue.length === 0) {
      // Deactivate after cooldown period
      setTimeout(() => {
        if (generationQueue.length === 0) {
          setGenerationThrottlingDetected(false)
          log("QUEUE", "THROTTLING_SUBSIDED_QUEUE_DEACTIVATED", {}, "INFO")
        }
      }, THROTTLING_COOLDOWN_MS)
    }
  }
}

// Process a queued generation request
async function processQueuedGenerationRequest(request: QueuedGenerationRequest): Promise<any> {
  const { user_id, project_id, query_text, word_limit, approach, runId } = request
  
  // Verify project ownership (required for queue processing)
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, owner_id, project_type, title")
    .eq("id", project_id)
    .eq("owner_id", user_id)
    .single()

  if (projectError || !project) {
    throw new Error("Project not found or access denied")
  }

  // Do embedding and retrieval for queued request
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

  const embedJson = JSON.parse(Buffer.from(embedRes.body!).toString("utf-8"))
  const queryEmbedding = embedJson?.embeddings?.[0]
  if (!queryEmbedding) {
    throw new Error("Embedding failed")
  }

  const { data: rawChunks, error: retrievalError } = await supabase.rpc("match_source_chunks", {
    query_embedding: queryEmbedding,
    match_project_id: project_id,
    match_count: 150,
  })

  if (retrievalError) {
    throw new Error("Retrieval failed")
  }

  log(runId, "QUEUE_RETRIEVAL_COMPLETE", { chunks_retrieved: rawChunks?.length || 0 })

  // Execute the core generation logic
  const result = await executeGeneration({
    runId,
    user_id,
    project_id,
    query_text,
    word_limit,
    approach,
    project,
    rawChunks: rawChunks ?? [],
  })

  return result
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

/* ================= CORE GENERATION LOGIC (EXTRACTED FOR QUEUE) ================= */

type GenerationParams = {
  runId: string
  user_id: string
  project_id: string
  query_text: string
  word_limit?: number
  approach?: any
  project: { id: string; owner_id: string; project_type: string; title: string }
  rawChunks: any[] // Pre-retrieved chunks
}

async function executeGeneration(params: GenerationParams): Promise<{
  reasoning_output: any
  evidence_index: Record<string, EvidenceMeta>
  source_coverage: any
  citation_quality_score: number
  coverage_analysis: any
}> {
  const { runId, user_id, project_id, query_text, word_limit, approach, project, rawChunks } = params

  // Detect explicit word count requests in query
  let effectiveWordLimit = word_limit
  if (!effectiveWordLimit) {
    const wordCountMatch = query_text.match(/(?:up to|approximately|about|around|at least|at most|minimum|maximum|max|min)?\s*(\d{1,5})\s*words?/i)
    if (wordCountMatch) {
      const requestedWords = parseInt(wordCountMatch[1], 10)
      if (requestedWords > 0 && requestedWords <= 5000) {
        effectiveWordLimit = requestedWords
        log(runId, "WORD_LIMIT_DETECTED", { detected_limit: effectiveWordLimit, from_query: true })
      }
    }
  }

  /* ================= LOAD PROJECT & SOURCE CONTEXT ================= */
  const projectType = project.project_type || "research_paper"
  log(runId, "PROJECT_CONTEXT", { project_type: projectType, title: project.title })

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
  const sourceIdToType = new Map<string, string>()
  for (const source of sources || []) {
    sourceIdToType.set(source.id, source.type)
  }

  const citationPatterns = analyzeCitationPatterns(rawChunks ?? [])
  const argumentGroups = identifyArgumentGroups(rawChunks ?? [], citationPatterns)

  const scoredChunks = (rawChunks ?? []).map((c: any) => {
    const text = c.text ?? ""
    const sourceType = sourceIdToType.get(c.source_id) || "other"
    const similarityScore = c.similarity || 0

    const sourceTypePriority: Record<string, number> = {
      case: 1.3,
      statute: 1.4,
      regulation: 1.3,
      constitution: 1.35,
      treaty: 1.35,
      journal_article: 1.1,
      book: 1.05,
      commentary: 1.05,
      working_paper: 1.0,
      thesis: 1.0,
      committee_report: 0.95,
      law_commission_report: 0.95,
      white_paper: 0.95,
      government_report: 0.95,
      blog_post: 0.85,
      news_article: 0.85,
      website: 0.8,
      other: 0.75,
    }
    const typeMultiplier = sourceTypePriority[sourceType] || 0.75
    const lengthScore = Math.min(1.0, Math.max(0.7, text.length / 500))
    const queryTerms = query_text.toLowerCase().split(/\W+/).filter(t => t.length > 3)
    const textLower = text.toLowerCase()
    const keywordMatches = queryTerms.filter(term => textLower.includes(term)).length
    const keywordBonus = Math.min(0.15, (keywordMatches / Math.max(1, queryTerms.length)) * 0.15)
    const pageBonus = Math.max(0.9, 1.0 - (c.page_number || 0) / 100)

    let argumentCoherenceBonus = 0
    for (const [groupId, chunkIds] of argumentGroups.entries()) {
      if (chunkIds.includes(c.id)) {
        const groupSize = chunkIds.length
        argumentCoherenceBonus = Math.min(0.2, groupSize * 0.05)
        const chunkIndex = chunkIds.indexOf(c.id)
        if (chunkIndex >= 0 && chunkIndex < chunkIds.length / 2) {
          argumentCoherenceBonus += 0.05
        }
        break
      }
    }

    const patterns = citationPatterns.get(c.id) || []
    const citationBonus = patterns.length * 0.02

    const finalScore = similarityScore * typeMultiplier * lengthScore * pageBonus + keywordBonus + argumentCoherenceBonus + citationBonus

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

  /* ================= ARGUMENT-BASED RE-RANKING (Source of Truth) ================= */
  // If an argumentation line is provided, re-rank chunks to prioritize evidence
  // that supports the selected approach. This makes the argument the "source of truth"
  // for the generation process.
  
  let finalScoredChunks = scoredChunks
  
  if (approach?.argumentation_line) {
    log(runId, "ARGUMENT_RERANKING_TRIGGERED", {
      argument_id: approach.argumentation_line.id,
      argument_title: approach.argumentation_line.title,
      focus_areas: approach.argumentation_line.focus_areas,
    })
    
    // Support combined arguments if multiple are provided (future enhancement)
    // For now, handle single argumentation line
    finalScoredChunks = rerankChunksForArgument(
      scoredChunks as ScoredChunk[],
      approach.argumentation_line as ArgumentationLine,
      runId
    )
    
    // Re-sort after re-ranking
    finalScoredChunks.sort((a: any, b: any) => b.score - a.score)
    
    log(runId, "ARGUMENT_RERANKING_APPLIED", {
      chunks_boosted: finalScoredChunks.filter((c: any) => c.argument_alignment > 0).length,
      top_reranked_scores: finalScoredChunks.slice(0, 5).map((c: any) => ({
        score: c.score.toFixed(3),
        argument_alignment: c.argument_alignment?.toFixed(3) || "0",
      })),
    })
  }

  // Select chunks using MMR (Maximal Marginal Relevance) for diversity
  const chunksBySource = new Map<string, typeof finalScoredChunks>()
  for (const chunk of finalScoredChunks) {
    if (!chunksBySource.has(chunk.source_id)) {
      chunksBySource.set(chunk.source_id, [])
    }
    chunksBySource.get(chunk.source_id)!.push(chunk)
  }

  const totalSources = chunksBySource.size
  const avgChunkSize = 500
  const estimatedChunks = Math.floor(MAX_EVIDENCE_CHARS / avgChunkSize)
  const maxChunksPerSource = Math.max(3, Math.ceil(estimatedChunks / Math.max(totalSources, 1) * 1.5))
  const primaryLawTypes = new Set(['statute', 'treaty', 'regulation', 'constitution', 'case'])

  log(runId, "MMR_DIVERSITY_CONFIG", {
    total_sources: totalSources,
    estimated_total_chunks: estimatedChunks,
    max_chunks_per_source: maxChunksPerSource,
    lambda: 0.7,
  })

  // Boost primary law source scores slightly before MMR
  const boostedChunks = finalScoredChunks.map((chunk: any) => {
    const sourceType = sourceIdToType.get(chunk.source_id) || "unknown"
    const isPrimaryLaw = primaryLawTypes.has(sourceType)
    return {
      ...chunk,
      score: isPrimaryLaw ? chunk.score * 1.1 : chunk.score,
    }
  })

  // Use MMR for chunk selection - balances relevance (0.7) with diversity (0.3)
  const { selected: boundedChunks, usedChars: initialUsedChars } = selectChunksWithMMR(
    boostedChunks as ScoredChunk[],
    MAX_EVIDENCE_CHARS,
    0.7,  // lambda: 70% relevance, 30% diversity
    maxChunksPerSource,
    runId
  )
  
  // Track used chars for expansion (mutable)
  let usedChars = initialUsedChars

  // Calculate source distribution for logging
  const sourceChunkCounts = new Map<string, number>()
  for (const chunk of boundedChunks) {
    sourceChunkCounts.set(
      chunk.source_id,
      (sourceChunkCounts.get(chunk.source_id) || 0) + 1
    )
  }

  const sourceDistribution: Record<string, number> = {}
  for (const [sourceId, count] of sourceChunkCounts.entries()) {
    const sourceType = sourceIdToType.get(sourceId) || "unknown"
    sourceDistribution[sourceType] = (sourceDistribution[sourceType] || 0) + count
  }

  if (!boundedChunks.length) {
    throw new Error("No usable evidence after balancing")
  }

  // Expand primary law chunks
  const expandedChunks: typeof boundedChunks = []
  const expandedChunkIds = new Set<string>()
  const chunksToExpand = new Set<string>()
  
  for (const chunk of boundedChunks) {
    const sourceType = sourceIdToType.get(chunk.source_id) || "unknown"
    if (primaryLawTypes.has(sourceType)) {
      chunksToExpand.add(chunk.id)
    }
  }
  
  if (chunksToExpand.size > 0) {
    const chunksBySourceForExpansion = new Map<string, typeof boundedChunks>()
    for (const chunk of boundedChunks) {
      if (!chunksBySourceForExpansion.has(chunk.source_id)) {
        chunksBySourceForExpansion.set(chunk.source_id, [])
      }
      chunksBySourceForExpansion.get(chunk.source_id)!.push(chunk)
    }
    
    for (const [sourceId, selectedChunks] of chunksBySourceForExpansion.entries()) {
      const sourceType = sourceIdToType.get(sourceId) || "unknown"
      if (!primaryLawTypes.has(sourceType)) {
        for (const chunk of selectedChunks) {
          if (!expandedChunkIds.has(chunk.id)) {
            expandedChunks.push(chunk)
            expandedChunkIds.add(chunk.id)
          }
        }
        continue
      }
      
      const { data: sourceCheck } = await supabase
        .from("project_sources")
        .select("id")
        .eq("id", sourceId)
        .eq("project_id", project_id)
        .single()

      if (!sourceCheck) {
        for (const chunk of selectedChunks) {
          if (!expandedChunkIds.has(chunk.id)) {
            expandedChunks.push(chunk)
            expandedChunkIds.add(chunk.id)
          }
        }
        continue
      }

      const { data: allSourceChunks } = await supabase
        .from("source_chunks")
        .select("id, text, chunk_index, page_number, paragraph_index")
        .eq("source_id", sourceId)
        .order("chunk_index", { ascending: true })
      
      if (!allSourceChunks || allSourceChunks.length === 0) {
        for (const chunk of selectedChunks) {
          if (!expandedChunkIds.has(chunk.id)) {
            expandedChunks.push(chunk)
            expandedChunkIds.add(chunk.id)
          }
        }
        continue
      }
      
      const chunkIndexMap = new Map<number, any>()
      const chunkIdToIndex = new Map<string, number>()
      for (const c of allSourceChunks) {
        chunkIndexMap.set(c.chunk_index, c)
        chunkIdToIndex.set(c.id, c.chunk_index)
      }
      
      const ADJACENT_RANGE = 1
      for (const selectedChunk of selectedChunks) {
        if (!expandedChunkIds.has(selectedChunk.id)) {
          expandedChunks.push(selectedChunk)
          expandedChunkIds.add(selectedChunk.id)
        }
        
        const selectedChunkIndex = chunkIdToIndex.get(selectedChunk.id)
        if (selectedChunkIndex === undefined) continue
        
        const startIndex = Math.max(0, selectedChunkIndex - ADJACENT_RANGE)
        const endIndex = Math.min(allSourceChunks.length - 1, selectedChunkIndex + ADJACENT_RANGE)
        
        for (let idx = startIndex; idx <= endIndex; idx++) {
          if (idx === selectedChunkIndex) continue
          const adjacentChunk = chunkIndexMap.get(idx)
          if (adjacentChunk && !expandedChunkIds.has(adjacentChunk.id)) {
            const adjacentText = adjacentChunk.text || ""
            const additionalChars = adjacentText.length
            if (usedChars + additionalChars <= MAX_EVIDENCE_CHARS * 1.1) {
              const originalChunk = finalScoredChunks.find((c: any) => c.id === adjacentChunk.id) || rawChunks?.find((c: any) => c.id === adjacentChunk.id)
              if (originalChunk) {
                expandedChunks.push({ ...originalChunk, is_expanded_context: true })
              } else {
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
    
    for (const chunk of boundedChunks) {
      const sourceType = sourceIdToType.get(chunk.source_id) || "unknown"
      if (!primaryLawTypes.has(sourceType) && !expandedChunkIds.has(chunk.id)) {
        expandedChunks.push(chunk)
        expandedChunkIds.add(chunk.id)
      }
    }
    
    boundedChunks.length = 0
    boundedChunks.push(...expandedChunks)
  }

  log(runId, "CHUNK_SELECTION_COMPLETE", {
    total_chunks: boundedChunks.length,
    sources_represented: sourceChunkCounts.size,
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
    word_limit: effectiveWordLimit,
  })

  const genRes = await sendWithRetry(
    new InvokeModelWithResponseStreamCommand({
      modelId: GENERATION_INFERENCE_PROFILE_ARN,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        max_tokens: 30000,
        temperature: 0.2,
      }),
    }),
    runId
  )

  let streamText = ""
  for await (const event of (genRes as any).body) {
    if (!event.chunk?.bytes) continue
    const parsed = JSON.parse(Buffer.from(event.chunk.bytes).toString("utf-8"))
    if (parsed.type === "content_block_delta") {
      streamText += parsed.delta?.text ?? ""
    }
  }

  const jsonSlice = extractLastCompleteJSONObject(streamText)
  if (!jsonSlice) {
    throw new Error("Model output truncated before JSON completion")
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
        throw new Error("Paragraph without evidence citation")
      }
      
      for (const eid of p.evidence_ids) {
        if (!validChunkIds.has(eid)) {
          throw new Error("Model cited unknown evidence ID")
        }
      }
      
      if (p.citations && Array.isArray(p.citations)) {
        const citedEvidenceIds = new Set(p.evidence_ids)
        for (const citation of p.citations) {
          if (!citation.evidence_id || !validChunkIds.has(citation.evidence_id)) {
            throw new Error("Citation references invalid evidence ID")
          }
          if (!['direct', 'substantial', 'reference'].includes(citation.usage_type)) {
            throw new Error("Invalid usage_type in citation")
          }
          if (citation.char_start !== undefined && citation.char_end !== undefined) {
            const chunkContent = chunkContentMap.get(citation.evidence_id) || ""
            if (citation.char_start < 0 || citation.char_end > chunkContent.length || citation.char_start > citation.char_end) {
              log(runId, "CITATION_POSITION_WARNING", {
                evidence_id: citation.evidence_id,
                char_start: citation.char_start,
                char_end: citation.char_end,
                chunk_length: chunkContent.length,
              }, "WARN")
            }
          }
          if (citation.usage_type === 'direct' && !citation.quoted_text) {
            log(runId, "MISSING_QUOTED_TEXT", { evidence_id: citation.evidence_id }, "WARN")
          }
        }
        
        for (const eid of p.evidence_ids) {
          const hasCitation = p.citations.some((c: any) => c.evidence_id === eid)
          if (!hasCitation) {
            log(runId, "MISSING_CITATION_FOR_EVIDENCE", { evidence_id: eid, paragraph_index: p.paragraph_index }, "WARN")
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
  const source_coverage = checkSourceCoverage(boundedChunks, reasoningOutput, runId)

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

  return {
    reasoning_output: reasoningOutput,
    evidence_index: evidenceIndex,
    source_coverage,
    citation_quality_score: source_coverage.quality_score,
    coverage_analysis: source_coverage.coverage_details,
  }
}

/* ================= HANDLER ================= */

export async function POST(req: Request) {
  const runId = crypto.randomUUID().slice(0, 8)
  log(runId, "REQUEST_START")

  let user_id: string | undefined = undefined

  try {
    const body = (await req.json()) as ReasoningRunInput
    let { project_id, query_text, mode = "generate", word_limit, approach, user_id: userId, user_email } = body
    user_id = userId

    if (!project_id || !query_text?.trim()) {
      return NextResponse.json(
        { error: "Missing project_id or query_text" },
        { status: 400 }
      )
    }

    // Authentication: require user_id
    if (!user_id) {
      return NextResponse.json(
        { error: "Authentication required. Missing user_id." },
        { status: 401 }
      )
    }

    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, owner_id, project_type, title")
      .eq("id", project_id)
      .eq("owner_id", user_id)
      .single()

    if (projectError || !project) {
      log(runId, "PROJECT_ACCESS_DENIED", { project_id, user_id, error: projectError }, "WARN")
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 403 }
      )
    }

    log(runId, "PROJECT_ACCESS_VERIFIED", { project_id, user_id, project_type: project.project_type })

    // Log usage if user info is provided
    if (user_id && user_email) {
      try {
        await supabase.rpc('increment_usage_log', {
          p_user_id: user_id,
          p_user_email: user_email,
          p_feature: mode === "generate" ? "reasoning_generate" : "reasoning_retrieve",
          p_project_id: project_id
        })
        log(runId, "USAGE_LOGGED", { user_id, user_email, feature: mode === "generate" ? "reasoning_generate" : "reasoning_retrieve" })
      } catch (logError) {
        log(runId, "USAGE_LOG_FAILED", { error: logError, user_id }, "WARN")
        // Continue with processing even if logging fails
      }
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
    // Note: match_source_chunks RPC should respect project ownership via RLS or internal checks
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

    /* ================= PER-USER SINGLE-FLIGHT ================= */

    // Check if this user already has a generation in progress
    const userLock = userGenerationLocks.get(user_id)
    if (userLock?.inFlight) {
      const now = Date.now()
      const elapsed = userLock.startTime ? now - userLock.startTime : 0

      // If generation has been running for more than 5 minutes, allow new requests
      if (elapsed > GENERATION_TIMEOUT_MS) {
        log(runId, "GENERATION_TIMEOUT_RESET", { user_id, elapsed_ms: elapsed, timeout_ms: GENERATION_TIMEOUT_MS }, "WARN")
        userGenerationLocks.set(user_id, { inFlight: false, startTime: null })
      } else {
        // Return error message asking user to try again later
        log(runId, "GENERATION_BUSY", { user_id, elapsed_ms: elapsed, remaining_ms: GENERATION_TIMEOUT_MS - elapsed }, "WARN")
        return NextResponse.json(
          { error: "You already have a generation in progress. Please wait for it to complete or try again in a few minutes." },
          { status: 429 }
        )
      }
    }

    /* ================= CONDITIONAL QUEUE CHECK ================= */

    // If throttling is detected and queue mode is active, queue the request
    // Note: Queue mode activates automatically when throttling is detected in sendWithRetry
    const queueStatusCheck = getGenerationQueueStatus(user_id)
    if (queueStatusCheck.queue_mode_active && mode === "generate") {
      // Return immediate response with queue info, then process in background
      const queuePosition = generationQueue.length + 1
      log(runId, "QUEUE_REQUEST", { user_id, queue_length: generationQueue.length, queue_position: queuePosition })
      
      return new Promise<NextResponse>((resolve, reject) => {
        const queuedRequest: QueuedGenerationRequest = {
          user_id: user_id!, // We already checked authentication above
          project_id,
          query_text,
          mode,
          word_limit,
          approach,
          resolve: (value: any) => {
            if (value instanceof NextResponse) {
              resolve(value)
            } else {
              resolve(NextResponse.json(value))
            }
          },
          reject: (error: any) => {
            reject(NextResponse.json(
              { error: error?.message || "Queue processing failed" },
              { status: 500 }
            ))
          },
          runId,
          queuedAt: Date.now(),
        }
        
        generationQueue.push(queuedRequest)
        
        // Return immediate response with queue status
        resolve(NextResponse.json({
          queued: true,
          queue_position: queuePosition,
          estimated_wait_seconds: (queuePosition - 1) * 60,
          total_queue_length: generationQueue.length,
          message: "Request queued due to high load. Processing will begin automatically.",
        }, { status: 202 })) // 202 Accepted - request queued
        
        // Start processing queue if not already processing
        processGenerationQueue().catch(err => {
          log(runId, "QUEUE_PROCESS_ERROR", { error: err }, "ERROR")
        })
        
        // Set timeout for queued request (10 minutes max wait)
        setTimeout(() => {
          const index = generationQueue.indexOf(queuedRequest)
          if (index !== -1) {
            generationQueue.splice(index, 1)
            // Request will timeout, but we've already returned 202
          }
        }, 10 * 60 * 1000)
      })
    }

    // Acquire lock for this user
    userGenerationLocks.set(user_id, { inFlight: true, startTime: Date.now() })
    const queueStatus = getGenerationQueueStatus(user_id)
    log(runId, "GENERATION_LOCK_ACQUIRED", { project_id: project_id, user_id, queue_mode: queueStatus.queue_mode_active })

    try {
      // Execute the core generation logic (rawChunks already retrieved above)
      const result = await executeGeneration({
        runId,
        user_id,
        project_id,
        query_text,
        word_limit,
        approach,
        project,
        rawChunks: rawChunks ?? [],
      })

      return NextResponse.json(result)

    } finally {
      // Release lock for this user
      userGenerationLocks.set(user_id, { inFlight: false, startTime: null })
      log(runId, "LOCK_RELEASED", { user_id })
    }

  } catch (err) {
    // Release lock for this user on error
    if (user_id) {
      userGenerationLocks.set(user_id, { inFlight: false, startTime: null })
    }
    log(runId, "FATAL_ERROR", err, "ERROR")
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    )
  }
}
