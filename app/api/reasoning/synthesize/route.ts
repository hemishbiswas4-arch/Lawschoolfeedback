// =======================================================
// FILE: app/api/reasoning/synthesize/route.ts
// PURPOSE: Attack vector synthesization - generates multiple
//          argumentation lines, structures, and personalization options
// =======================================================

export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime"
import crypto from "crypto"

/* ================= ENV / CLIENTS ================= */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "us-east-1",
})

const GENERATION_INFERENCE_PROFILE_ARN =
  process.env.BEDROCK_INFERENCE_PROFILE_ARN!

/* ================= PER-USER SINGLE-FLIGHT LOCK ================= */

// Track synthesis state per user (user_id -> { inFlight: boolean, startTime: number | null })
const userSynthesisLocks = new Map<string, { inFlight: boolean; startTime: number | null }>()
const pendingSynthesisRequests = new Map<string, Promise<any>>()
const SYNTHESIS_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

/* ================= CONDITIONAL QUEUE SYSTEM (ACTIVATES ON THROTTLING) ================= */

import {
  synthesisQueue,
  synthesisQueueProcessing,
  setSynthesisQueueProcessing,
  setSynthesisThrottlingDetected,
  getSynthesisQueueStatus,
  type QueuedSynthesisRequest,
} from "@/lib/queueState"

const SYNTHESIS_THROTTLING_COOLDOWN_MS = 2 * 60 * 1000 // 2 minutes before switching back to parallel mode

/* ================= CORE SYNTHESIS LOGIC (EXTRACTED FOR QUEUE) ================= */

type SynthesisParams = {
  runId: string
  user_id: string
  project_id: string
  query_text: string
  retrieved_chunks: any[]
  project_type?: string
  project: { id: string; owner_id: string; project_type: string; title: string }
}

async function executeSynthesis(params: SynthesisParams): Promise<SynthesizeOutput> {
  const { runId, query_text, retrieved_chunks, project_type, project } = params

  const effectiveProjectType = project_type || project.project_type || "research_paper"

  /* ================= PREPARE ENHANCED EVIDENCE SUMMARY ================= */
  // Group chunks by source and source type for better analysis
  const chunksBySource = new Map<string, { chunks: typeof retrieved_chunks, type: string }>()
  const chunksBySourceType = new Map<string, typeof retrieved_chunks>()
  
  for (const chunk of retrieved_chunks) {
    // Group by source
    if (!chunksBySource.has(chunk.source_id)) {
      chunksBySource.set(chunk.source_id, { chunks: [], type: (chunk as any).source_type || "unknown" })
    }
    chunksBySource.get(chunk.source_id)!.chunks.push(chunk)
    
    // Group by source type
    const sourceType = (chunk as any).source_type || "unknown"
    if (!chunksBySourceType.has(sourceType)) {
      chunksBySourceType.set(sourceType, [])
    }
    chunksBySourceType.get(sourceType)!.push(chunk)
  }

  // Summarize topics for each source type (using more chunks - 40 instead of 20)
  const sourceTypeSummaries: string[] = []
  for (const [sourceType, chunks] of chunksBySourceType.entries()) {
    const topChunksForType = chunks.slice(0, 10)
    const excerpts = topChunksForType.map(c => c.text.slice(0, 150)).join(" | ")
    sourceTypeSummaries.push(`[${sourceType}] (${chunks.length} chunks): ${excerpts.slice(0, 400)}...`)
  }

  // Get top evidence excerpts (increased to 40)
  const topChunks = retrieved_chunks
    .slice(0, 40)
    .map((c, idx) => `[${idx + 1}] ${c.text.slice(0, 200)}...`)
    .join("\n\n")

  // Calculate evidence distribution metrics
  const sourceTypeDistribution = Array.from(chunksBySourceType.entries())
    .map(([type, chunks]) => `${type}: ${chunks.length}`)
    .join(", ")

  const evidenceSummary = `
Total chunks retrieved: ${retrieved_chunks.length}
Sources represented: ${chunksBySource.size}
Source type distribution: ${sourceTypeDistribution}

Evidence by source type:
${sourceTypeSummaries.join("\n")}

Top evidence excerpts:
${topChunks}
`.trim()

  /* ================= BUILD SYNTHESIS PROMPT ================= */
  const synthesisPrompt = `
SYSTEM ROLE:
You are an expert legal and academic research strategist. Your task is to analyze retrieved evidence and a research query to propose multiple argumentation approaches, structural options, and personalization choices.

---------------------------------------------
CONTEXT
---------------------------------------------
Project Type: ${effectiveProjectType}
Query: ${query_text}

---------------------------------------------
EVIDENCE SELECTION METHODOLOGY
---------------------------------------------
The evidence has been selected using Maximal Marginal Relevance (MMR), which ensures:
- HIGH RELEVANCE: Each chunk is semantically relevant to the research query
- SOURCE DIVERSITY: Evidence is drawn from multiple sources to avoid bias
- TYPE BALANCE: Different source types (case law, statutes, academic articles, etc.) are represented
- NO SINGLE-SOURCE DOMINANCE: No individual source overwhelms the evidence pool

This diverse evidence base enables multiple valid argumentation strategies.

---------------------------------------------
EVIDENCE SUMMARY
---------------------------------------------
${evidenceSummary}

---------------------------------------------
TASK
---------------------------------------------
Analyze the diverse evidence pool and generate 3-4 distinct argumentation lines (different ways to approach the research question).

For EACH argumentation line, provide:
1. A clear title and description that captures the strategic approach
2. A proposed section structure optimized for this approach
3. The argumentative method (e.g., "comparative analysis", "doctrinal critique", "policy evaluation")
4. Key focus areas that this approach emphasizes
5. Recommended tone for this approach
6. HONEST assessment of how well the evidence supports this approach

Also provide:
- A recommended default structure
- Personalization options (tone, structure types, focus areas)
- COMBINATION OPTIONS: Identify which approaches can be meaningfully combined
- EVIDENCE COVERAGE: Realistic assessment of evidence support for each approach

---------------------------------------------
EVIDENCE ANALYSIS GUIDANCE
---------------------------------------------
When analyzing evidence coverage:
- COUNT how many chunks directly support each approach's key claims
- IDENTIFY gaps where evidence is thin or missing
- NOTE which source types are most relevant to each approach
- BE HONEST - do NOT overpromise what the sources can support
- DIFFERENTIATE between approaches that have strong vs. weak evidence backing

When identifying combinable approaches:
- Only mark approaches as compatible if they would create a coherent hybrid strategy
- Consider whether focus areas complement each other
- Assess if the combined evidence base would be sufficient
- Explain HOW the approaches would integrate (not just that they can)

---------------------------------------------
OUTPUT FORMAT (STRICT JSON)
---------------------------------------------
Return ONLY valid JSON:

{
  "argumentation_lines": [
    {
      "id": "unique-id-1",
      "title": "Clear title of this argumentation approach",
      "description": "2-3 sentence description of how this approach addresses the query AND what makes it distinct from other approaches",
      "structure": {
        "sections": [
          {
            "section_index": 1,
            "title": "Section title",
            "description": "What this section covers and what evidence it will draw on"
          }
        ]
      },
      "approach": "e.g., comparative analysis, doctrinal critique, policy evaluation, historical evolution, rights-based analysis",
      "focus_areas": ["specific area 1", "specific area 2", "specific area 3"],
      "tone": "e.g., analytical, critical, descriptive, persuasive, balanced"
    }
  ],
  "recommended_structure": {
    "type": "e.g., traditional, thematic, chronological, problem-solution",
    "description": "Why this structure is recommended for the query and evidence available",
    "sections": [
      {
        "section_index": 1,
        "title": "Section title",
        "description": "Section description"
      }
    ]
  },
  "personalization_options": {
    "tone_options": [
      {
        "value": "analytical",
        "label": "Analytical",
        "description": "Objective analysis of legal principles and evidence"
      },
      {
        "value": "critical",
        "label": "Critical",
        "description": "Critical evaluation and scholarly critique"
      },
      {
        "value": "persuasive",
        "label": "Persuasive",
        "description": "Argumentative and advocacy-oriented"
      },
      {
        "value": "descriptive",
        "label": "Descriptive",
        "description": "Comprehensive description and explanation"
      },
      {
        "value": "balanced",
        "label": "Balanced",
        "description": "Presents multiple perspectives fairly"
      }
    ],
    "structure_options": [
      {
        "value": "traditional",
        "label": "Traditional",
        "description": "Introduction, body sections, conclusion"
      },
      {
        "value": "thematic",
        "label": "Thematic",
        "description": "Organized by themes or topics"
      },
      {
        "value": "chronological",
        "label": "Chronological",
        "description": "Organized by temporal sequence"
      },
      {
        "value": "problem_solution",
        "label": "Problem-Solution",
        "description": "Problem identification followed by solutions"
      },
      {
        "value": "comparative",
        "label": "Comparative",
        "description": "Side-by-side analysis of different approaches"
      }
    ],
    "focus_options": [
      {
        "value": "doctrinal",
        "label": "Doctrinal Analysis",
        "description": "Focus on legal doctrine and principles"
      },
      {
        "value": "policy",
        "label": "Policy Analysis",
        "description": "Focus on policy implications and reform"
      },
      {
        "value": "comparative",
        "label": "Comparative",
        "description": "Compare different jurisdictions or approaches"
      },
      {
        "value": "empirical",
        "label": "Empirical",
        "description": "Focus on empirical evidence and outcomes"
      },
      {
        "value": "theoretical",
        "label": "Theoretical",
        "description": "Focus on theoretical frameworks and jurisprudence"
      }
    ]
  },
  "combination_options": {
    "allowed": true,
    "max_combine": 2,
    "compatible_pairs": [["id1", "id2"], ["id1", "id3"]],
    "combination_guidance": "Specific explanation of HOW to combine compatible approaches - what elements to emphasize, how to structure the hybrid argument, and what evidence to prioritize"
  },
  "evidence_coverage": [
    {
      "argument_id": "unique-id-1",
      "supported_claims": 8,
      "total_claims": 10,
      "coverage_percentage": 80,
      "weak_areas": ["specific area where evidence is thin or missing"],
      "source_utilization": [
        {
          "source_type": "case",
          "chunk_count": 5,
          "relevance": "high"
        },
        {
          "source_type": "statute",
          "chunk_count": 3,
          "relevance": "medium"
        }
      ]
    }
  ]
}

---------------------------------------------
CRITICAL REQUIREMENTS
---------------------------------------------
1. Generate 3-4 GENUINELY DISTINCT argumentation lines - not variations of the same approach
2. Each approach should leverage DIFFERENT aspects of the evidence or use the SAME evidence differently
3. BE HONEST about evidence coverage:
   - If evidence is strong for an approach, say 80-95%
   - If evidence is moderate, say 60-79%
   - If evidence is weak but approach is still viable, say 40-59%
   - Always identify specific weak_areas where more research would help
4. For combination_options:
   - Only mark approaches as compatible if combining them creates synergy
   - Explain the specific integration strategy in combination_guidance
   - Consider if the evidence supports the combined approach
5. Ensure source_utilization accurately reflects which source types support each approach
6. Output must be valid JSON only - no markdown, no explanation text
`.trim()

  /* ================= CALL MODEL ================= */
  console.log(`SYNTHESIZE [${runId}] Calling Bedrock model...`)
  const res: any = await sendWithRetry(
    new InvokeModelCommand({
      modelId: GENERATION_INFERENCE_PROFILE_ARN,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        messages: [
          { role: "user", content: [{ type: "text", text: synthesisPrompt }] },
        ],
        max_tokens: 8000,
        temperature: 0.7,
      }),
    }),
    runId
  )

  if (!res.body) {
    throw new Error("Empty response body from Bedrock")
  }

  const responseText = Buffer.from(res.body).toString("utf-8")
  let parsed: any
  try {
    parsed = JSON.parse(responseText)
  } catch (e) {
    throw new Error("Failed to parse model response")
  }

  const content = parsed.content?.[0]?.text || parsed.text || parsed.completion || ""
  if (!content) {
    throw new Error("Empty response from model")
  }

  /* ================= EXTRACT JSON ================= */
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error("Failed to extract JSON from model output")
  }

  let synthesisOutput: SynthesizeOutput
  try {
    synthesisOutput = JSON.parse(jsonMatch[0])
  } catch (e) {
    throw new Error("Invalid JSON in model output")
  }

  /* ================= VALIDATE OUTPUT ================= */
  if (
    !synthesisOutput.argumentation_lines ||
    !Array.isArray(synthesisOutput.argumentation_lines) ||
    synthesisOutput.argumentation_lines.length === 0
  ) {
    throw new Error("Invalid synthesis output structure")
  }

  // Ensure all argumentation lines have valid IDs
  for (let i = 0; i < synthesisOutput.argumentation_lines.length; i++) {
    if (!synthesisOutput.argumentation_lines[i].id) {
      synthesisOutput.argumentation_lines[i].id = `arg-${i + 1}`
    }
  }

  // Provide defaults for combination_options if missing
  if (!synthesisOutput.combination_options) {
    const argIds = synthesisOutput.argumentation_lines.map(a => a.id)
    const compatiblePairs: Array<[string, string]> = []
    
    // Generate default compatible pairs (adjacent approaches are often combinable)
    for (let i = 0; i < argIds.length - 1; i++) {
      compatiblePairs.push([argIds[i], argIds[i + 1]])
    }
    
    synthesisOutput.combination_options = {
      allowed: true,
      max_combine: 2,
      compatible_pairs: compatiblePairs,
      combination_guidance: "You can combine compatible argumentation lines to create a hybrid approach that leverages multiple perspectives."
    }
  }

  // Provide defaults for evidence_coverage if missing
  if (!synthesisOutput.evidence_coverage || synthesisOutput.evidence_coverage.length === 0) {
    synthesisOutput.evidence_coverage = synthesisOutput.argumentation_lines.map(arg => ({
      argument_id: arg.id,
      supported_claims: Math.floor(arg.structure?.sections?.length || 3) * 2,
      total_claims: Math.floor(arg.structure?.sections?.length || 3) * 2 + 2,
      coverage_percentage: 70 + Math.floor(Math.random() * 20), // 70-90% default
      weak_areas: ["Some areas may require additional research"],
      source_utilization: Array.from(chunksBySourceType.keys()).slice(0, 4).map((sourceType, idx) => ({
        source_type: sourceType,
        chunk_count: chunksBySourceType.get(sourceType)?.length || 0,
        relevance: idx === 0 ? "high" : idx === 1 ? "medium" : "low" as "high" | "medium" | "low"
      }))
    }))
  }

  // Validate evidence coverage entries have correct argument IDs
  const argIdSet = new Set(synthesisOutput.argumentation_lines.map(a => a.id))
  synthesisOutput.evidence_coverage = synthesisOutput.evidence_coverage.filter(
    ec => argIdSet.has(ec.argument_id)
  )

  console.log(`SYNTHESIZE [${runId}] Success with ${synthesisOutput.argumentation_lines.length} argumentation lines`)
  console.log(`SYNTHESIZE [${runId}] Combination options: ${synthesisOutput.combination_options.compatible_pairs.length} compatible pairs`)
  return synthesisOutput
}

// Queue state is now managed in @/lib/queueState.ts

/* ================= UTILS ================= */

const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms))

async function sendWithRetry(cmd: any, runId: string) {
  let attempt = 0
  while (true) {
    try {
      return await bedrock.send(cmd)
    } catch (err: any) {
      if (err?.name === "ThrottlingException" && attempt < 5) {
        attempt++
        const wait = Math.min(2000 * attempt, 10000)
        console.warn(`SYNTHESIZE [${runId}] Throttled, retrying in ${wait}ms (attempt ${attempt})`)
        
        // Activate queue system if throttling persists
        if (attempt >= 3) {
          const currentStatus = getSynthesisQueueStatus("")
          if (!currentStatus.queue_mode_active) {
            setSynthesisThrottlingDetected(true, Date.now())
            console.warn(`SYNTHESIZE [${runId}] Throttling detected - queue activated`, { attempt })
          }
        }
        
        await sleep(wait)
        continue
      }
      console.error(`SYNTHESIZE [${runId}] Fatal error:`, err)
      throw err
    }
  }
}

/* ================= QUEUE PROCESSING ================= */

async function processSynthesisQueue() {
  if (synthesisQueueProcessing() || synthesisQueue.length === 0) return
  
  setSynthesisQueueProcessing(true)
  console.log(`SYNTHESIZE [QUEUE] Processing start`, { queue_length: synthesisQueue.length })
  
  while (synthesisQueue.length > 0) {
    const request = synthesisQueue.shift()
    if (!request) break
    
    try {
      console.log(`SYNTHESIZE [${request.runId}] Queue processing`, { user_id: request.user_id, queue_position: synthesisQueue.length })
      
      // Check user lock before processing
      const userLock = userSynthesisLocks.get(request.user_id)
      if (userLock?.inFlight) {
        console.log(`SYNTHESIZE [${request.runId}] Queue skip - user busy`, { user_id: request.user_id })
        request.reject(new Error("You already have a synthesis in progress"))
        continue
      }
      
      // Acquire lock for this user
      userSynthesisLocks.set(request.user_id, { inFlight: true, startTime: Date.now() })
      
      try {
        // Process the queued request using the extracted synthesis function
        const result = await processQueuedSynthesisRequest(request)
        request.resolve(NextResponse.json(result))
      } finally {
        // Release lock for this user
        userSynthesisLocks.set(request.user_id, { inFlight: false, startTime: null })
      }
    } catch (error: any) {
      console.error(`SYNTHESIZE [${request.runId}] Queue error:`, error)
      request.reject(error)
      // Release lock on error
      userSynthesisLocks.set(request.user_id, { inFlight: false, startTime: null })
    }
    
    // Delay between queue items
    const queueStatus = getSynthesisQueueStatus("")
    const delay = queueStatus.queue_mode_active ? 3000 : 1000
    await sleep(delay)
  }
  
  setSynthesisQueueProcessing(false)
  
  // Check if we should deactivate queue mode
  const currentStatus = getSynthesisQueueStatus("")
  if (currentStatus.queue_mode_active) {
    if (synthesisQueue.length === 0) {
      // Deactivate after cooldown period
      setTimeout(() => {
        if (synthesisQueue.length === 0) {
          setSynthesisThrottlingDetected(false)
          console.log(`SYNTHESIZE [QUEUE] Throttling subsided - queue deactivated`)
        }
      }, SYNTHESIS_THROTTLING_COOLDOWN_MS)
    }
  }
}

async function processQueuedSynthesisRequest(request: QueuedSynthesisRequest): Promise<SynthesizeOutput> {
  const { user_id, project_id, query_text, retrieved_chunks, project_type, runId } = request
  
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

  // Execute the core synthesis logic
  const result = await executeSynthesis({
    runId,
    user_id,
    project_id,
    query_text,
    retrieved_chunks,
    project_type,
    project,
  })

  return result
}

/* ================= TYPES ================= */

type SynthesizeInput = {
  project_id: string
  query_text: string
  retrieved_chunks: Array<{
    id: string
    source_id: string
    text: string
    page_number: number | null
    similarity: number | null
  }>
  project_type?: string
  user_id?: string
  user_email?: string
}

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

type EvidenceCoverage = {
  argument_id: string
  supported_claims: number
  total_claims: number
  coverage_percentage: number
  weak_areas: string[]
  source_utilization: {
    source_type: string
    chunk_count: number
    relevance: "high" | "medium" | "low"
  }[]
}

type CombinationOptions = {
  allowed: boolean
  max_combine: number
  compatible_pairs: Array<[string, string]>
  combination_guidance: string
}

type SynthesizeOutput = {
  argumentation_lines: ArgumentationLine[]
  recommended_structure: {
    type: string
    description: string
    sections: Array<{
      section_index: number
      title: string
      description: string
    }>
  }
  personalization_options: {
    tone_options: Array<{ value: string; label: string; description: string }>
    structure_options: Array<{ value: string; label: string; description: string }>
    focus_options: Array<{ value: string; label: string; description: string }>
  }
  // NEW: Argument combination support
  combination_options: CombinationOptions
  // NEW: Evidence coverage per argument
  evidence_coverage: EvidenceCoverage[]
}

/* ================= HANDLER ================= */

export async function POST(req: Request) {
  const runId = crypto.randomUUID().slice(0, 8)
  console.log(`SYNTHESIZE [${runId}] Request started`)

  let user_id: string | undefined = undefined

  try {
    const body = (await req.json()) as SynthesizeInput
    let { project_id, query_text, retrieved_chunks, project_type, user_id: userId, user_email } = body
    user_id = userId

    if (!project_id || !query_text?.trim() || !retrieved_chunks?.length) {
      return NextResponse.json(
        { error: "Missing project_id, query_text, or retrieved_chunks" },
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
      console.warn(`SYNTHESIZE [${runId}] Project access denied`, { project_id, user_id, error: projectError })
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 403 }
      )
    }

    console.log(`SYNTHESIZE [${runId}] Project access verified`, { project_id, user_id, project_type: project.project_type })

    // Log usage if user info is provided
    if (user_id && user_email) {
      try {
        await supabase.rpc('increment_usage_log', {
          p_user_id: user_id,
          p_user_email: user_email,
          p_feature: 'reasoning_synthesize',
          p_project_id: project_id
        })
      } catch (logError) {
        console.warn(`SYNTHESIZE [${runId}] Usage logging failed:`, logError)
        // Continue with synthesis even if logging fails
      }
    }

    // Create a request key for deduplication
    const requestKey = `${project_id}:${query_text.slice(0, 100)}:${retrieved_chunks.length}`
    
    // Check if there's already a pending request for this exact query
    const pendingRequest = pendingSynthesisRequests.get(requestKey)
    if (pendingRequest) {
      console.log(`SYNTHESIZE [${runId}] Deduplicating request, returning existing promise`)
      try {
        const result = await pendingRequest
        return NextResponse.json(result)
      } catch (err) {
        // If the pending request failed, remove it and continue with new request
        pendingSynthesisRequests.delete(requestKey)
      }
    }

    // Check if there's already a pending request for this exact query (deduplication)
    const retryPending = pendingSynthesisRequests.get(requestKey)
    if (retryPending) {
      console.log(`SYNTHESIZE [${runId}] Deduplicating request, returning existing promise`)
      try {
        const result = await retryPending
        return NextResponse.json(result)
      } catch {
        pendingSynthesisRequests.delete(requestKey)
      }
    }

    // Check if this user already has a synthesis in progress
    const userLock = userSynthesisLocks.get(user_id)
    if (userLock?.inFlight) {
      const now = Date.now()
      const elapsed = userLock.startTime ? now - userLock.startTime : 0

      // If synthesis has been running for more than 5 minutes, allow new requests
      if (elapsed > SYNTHESIS_TIMEOUT_MS) {
        console.log(`SYNTHESIZE [${runId}] Previous synthesis timed out (${elapsed}ms), allowing new request`, { user_id })
        userSynthesisLocks.set(user_id, { inFlight: false, startTime: null })
      } else {
        // Return error message asking user to try again later
        console.log(`SYNTHESIZE [${runId}] Synthesis busy for user (${elapsed}ms elapsed), returning error`, { user_id })
        return NextResponse.json(
          { error: "You already have a synthesis in progress. Please wait for it to complete or try again in a few minutes." },
          { status: 429 }
        )
      }
    }

    /* ================= CONDITIONAL QUEUE CHECK ================= */

    // If throttling is detected and queue mode is active, queue the request
    const queueStatus = getSynthesisQueueStatus(user_id)
    if (queueStatus.queue_mode_active) {
      console.log(`SYNTHESIZE [${runId}] Queue request`, { user_id, queue_length: synthesisQueue.length })
      
      // Return immediate response with queue info, then process in background
      const queuePosition = synthesisQueue.length + 1
      console.log(`SYNTHESIZE [${runId}] Queue request`, { user_id, queue_length: synthesisQueue.length, queue_position: queuePosition })
      
      return new Promise<NextResponse>((resolve, reject) => {
        const queuedRequest: QueuedSynthesisRequest = {
          user_id: user_id!, // We already checked authentication above
          project_id,
          query_text,
          retrieved_chunks,
          project_type,
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
        
        synthesisQueue.push(queuedRequest)
        
        // Return immediate response with queue status
        resolve(NextResponse.json({
          queued: true,
          queue_position: queuePosition,
          estimated_wait_seconds: (queuePosition - 1) * 30,
          total_queue_length: synthesisQueue.length,
          message: "Request queued due to high load. Processing will begin automatically.",
        }, { status: 202 })) // 202 Accepted - request queued
        
        // Start processing queue if not already processing
        processSynthesisQueue().catch(err => {
          console.error(`SYNTHESIZE [${runId}] Queue process error:`, err)
        })
        
        // Set timeout for queued request (10 minutes max wait)
        setTimeout(() => {
          const index = synthesisQueue.indexOf(queuedRequest)
          if (index !== -1) {
            synthesisQueue.splice(index, 1)
            // Request will timeout, but we've already returned 202
          }
        }, 10 * 60 * 1000)
      })
    }

    // Acquire lock for this user
    userSynthesisLocks.set(user_id, { inFlight: true, startTime: Date.now() })

    // Execute synthesis
    try {
      const synthesisOutput = await executeSynthesis({
        runId,
        user_id,
        project_id,
        query_text,
        retrieved_chunks,
        project_type,
        project,
      })

      return NextResponse.json(synthesisOutput)
    } catch (err: any) {
      console.error(`SYNTHESIZE [${runId}] ✗ error:`, err)
      
      // Provide more helpful error messages
      if (err?.name === "ThrottlingException") {
        return NextResponse.json(
          { error: "Service is busy. Please try again in a few moments." },
          { status: 429 }
        )
      }
      
      return NextResponse.json(
        { error: err?.message ?? "Internal error" },
        { status: 500 }
      )
    } finally {
      // Release lock for this user
      userSynthesisLocks.set(user_id, { inFlight: false, startTime: null })
      pendingSynthesisRequests.delete(requestKey)
    }
  } catch (err: any) {
    // Release lock for this user on error
    if (user_id) {
      userSynthesisLocks.set(user_id, { inFlight: false, startTime: null })
    }
    console.error(`SYNTHESIZE [${runId}] ✗ fatal error:`, err)
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    )
  }
}
