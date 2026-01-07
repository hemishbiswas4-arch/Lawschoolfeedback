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
    const { project_id, query_text, mode = "generate" } = body

    if (!project_id || !query_text?.trim()) {
      return NextResponse.json(
        { error: "Missing project_id or query_text" },
        { status: 400 }
      )
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

    const { data: rawChunks, error } = await supabase.rpc(
      "match_source_chunks",
      {
        query_embedding: queryEmbedding,
        match_project_id: project_id,
        match_count: 80,
      }
    )

    if (error) {
      return NextResponse.json(
        { error: "Retrieval failed" },
        { status: 500 }
      )
    }

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
      /* ================= SOURCE-BALANCED SELECTION ================= */

      let usedChars = 0
      const boundedChunks: any[] = []
      const chunksBySource = new Map<string, any[]>()

      for (const c of rawChunks ?? []) {
        if (!chunksBySource.has(c.source_id)) {
          chunksBySource.set(c.source_id, [])
        }
        chunksBySource.get(c.source_id)!.push(c)
      }

      for (const chunks of chunksBySource.values()) {
        const c = chunks[0]
        const text = c.text ?? ""
        if (usedChars + text.length > MAX_EVIDENCE_CHARS) break
        boundedChunks.push({ ...c, content: text })
        usedChars += text.length
      }

      outer: for (const chunks of chunksBySource.values()) {
        for (let i = 1; i < chunks.length; i++) {
          const c = chunks[i]
          const text = c.text ?? ""
          if (usedChars + text.length > MAX_EVIDENCE_CHARS) break outer
          boundedChunks.push({ ...c, content: text })
          usedChars += text.length
        }
      }

      if (!boundedChunks.length) {
        return NextResponse.json(
          { error: "No usable evidence after balancing" },
          { status: 500 }
        )
      }

      /* ================= PROMPT + GENERATION ================= */

      const prompt = buildReasoningPrompt({
        query_text,
        chunks: boundedChunks,
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
