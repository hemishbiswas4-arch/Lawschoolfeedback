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

/* ================= SINGLE-FLIGHT LOCK ================= */

let synthesisInFlight = false
const pendingSynthesisRequests = new Map<string, Promise<any>>()

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
        await sleep(wait)
        continue
      }
      console.error(`SYNTHESIZE [${runId}] Fatal error:`, err)
      throw err
    }
  }
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
}

/* ================= HANDLER ================= */

export async function POST(req: Request) {
  const runId = crypto.randomUUID().slice(0, 8)
  console.log(`SYNTHESIZE [${runId}] Request started`)

  try {
    const body = (await req.json()) as SynthesizeInput
    const { project_id, query_text, retrieved_chunks, project_type } = body

    if (!project_id || !query_text?.trim() || !retrieved_chunks?.length) {
      return NextResponse.json(
        { error: "Missing project_id, query_text, or retrieved_chunks" },
        { status: 400 }
      )
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

    // Check single-flight lock
    if (synthesisInFlight) {
      console.log(`SYNTHESIZE [${runId}] Another synthesis in progress, waiting...`)
      // Wait a bit and check again
      await sleep(1000)
      const retryPending = pendingSynthesisRequests.get(requestKey)
      if (retryPending) {
        try {
          const result = await retryPending
          return NextResponse.json(result)
        } catch {
          pendingSynthesisRequests.delete(requestKey)
        }
      }
    }

    synthesisInFlight = true

    // Create promise for this request
    const synthesisPromise = (async (): Promise<SynthesizeOutput> => {
      /* ================= LOAD PROJECT METADATA ================= */

      const { data: project } = await supabase
        .from("projects")
        .select("project_type, title")
        .eq("id", project_id)
        .single()

      const effectiveProjectType = project_type || project?.project_type || "research_paper"

      /* ================= PREPARE EVIDENCE SUMMARY ================= */

      const chunksBySource = new Map<string, number>()
      for (const chunk of retrieved_chunks) {
        const count = chunksBySource.get(chunk.source_id) || 0
        chunksBySource.set(chunk.source_id, count + 1)
      }

      const topChunks = retrieved_chunks
        .slice(0, 20)
        .map((c, idx) => `[${idx + 1}] ${c.text.slice(0, 200)}...`)
        .join("\n\n")

      const evidenceSummary = `
Total chunks retrieved: ${retrieved_chunks.length}
Sources represented: ${chunksBySource.size}
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
EVIDENCE SUMMARY
---------------------------------------------
${evidenceSummary}

---------------------------------------------
TASK
---------------------------------------------
Generate 3-4 distinct argumentation lines (different ways to approach the research question), each with:
1. A clear title and description
2. A proposed section structure
3. The argumentative approach (e.g., "comparative analysis", "doctrinal critique", "policy evaluation")
4. Key focus areas
5. Recommended tone

Also provide:
- A recommended default structure
- Personalization options (tone, structure types, focus areas)

---------------------------------------------
OUTPUT FORMAT (STRICT JSON)
---------------------------------------------
Return ONLY valid JSON:

{
  "argumentation_lines": [
    {
      "id": "unique-id-1",
      "title": "Clear title of this argumentation approach",
      "description": "2-3 sentence description of how this approach addresses the query",
      "structure": {
        "sections": [
          {
            "section_index": 1,
            "title": "Section title",
            "description": "What this section covers"
          }
        ]
      },
      "approach": "e.g., comparative analysis, doctrinal critique, policy evaluation, historical evolution",
      "focus_areas": ["area1", "area2", "area3"],
      "tone": "e.g., analytical, critical, descriptive, persuasive"
    }
  ],
  "recommended_structure": {
    "type": "e.g., traditional, thematic, chronological",
    "description": "Why this structure is recommended",
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
        "description": "Objective analysis of legal principles"
      },
      {
        "value": "critical",
        "label": "Critical",
        "description": "Critical evaluation and critique"
      },
      {
        "value": "persuasive",
        "label": "Persuasive",
        "description": "Argumentative and persuasive tone"
      },
      {
        "value": "descriptive",
        "label": "Descriptive",
        "description": "Comprehensive description and explanation"
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
        "description": "Focus on policy implications"
      },
      {
        "value": "comparative",
        "label": "Comparative",
        "description": "Compare different jurisdictions or approaches"
      },
      {
        "value": "empirical",
        "label": "Empirical",
        "description": "Focus on empirical evidence and data"
      }
    ]
  }
}

IMPORTANT:
- Generate 3-4 distinct argumentation lines
- Each line should offer a genuinely different approach
- Be specific and grounded in the evidence provided
- Output must be valid JSON only
`.trim()

      /* ================= CALL MODEL ================= */

      console.log(`SYNTHESIZE [${runId}] Calling Bedrock model...`)
      const res = await sendWithRetry(
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

      const responseText = Buffer.from(res.body!).toString("utf-8")
      let parsed: any
      try {
        parsed = JSON.parse(responseText)
      } catch (e) {
        throw new Error("Failed to parse model response")
      }

      // Handle different response formats from Bedrock
      const content = parsed.content?.[0]?.text || parsed.text || parsed.completion || ""
      
      if (!content) {
        throw new Error("Empty response from model")
      }

      /* ================= EXTRACT JSON ================= */

      // Try to find JSON in the response
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

      console.log(`SYNTHESIZE [${runId}] Success`)
      return synthesisOutput
    })()

    // Store the promise for deduplication
    pendingSynthesisRequests.set(requestKey, synthesisPromise)

    try {
      const synthesisOutput = await synthesisPromise
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
      synthesisInFlight = false
      pendingSynthesisRequests.delete(requestKey)
    }

  } catch (err: any) {
    synthesisInFlight = false
    console.error(`SYNTHESIZE [${runId}] ✗ fatal error:`, err)
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    )
  }
}
