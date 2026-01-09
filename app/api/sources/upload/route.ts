// =======================================================
// FILE: app/api/sources/upload/route.ts
// PURPOSE:
//   - Upload PDFs
//   - Chunk text
//   - Embed every chunk (Cohere via Bedrock)
//   - Store vectorized chunks for retrieval
// =======================================================

export const runtime = "nodejs"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime"
import * as pdfjs from "pdfjs-dist/legacy/build/pdf"
import crypto from "crypto"
import nlp from "compromise"
import natural from "natural"

/* 🔴 REQUIRED FOR NODE PDFJS */
;(pdfjs as any).GlobalWorkerOptions.workerSrc =
  require("pdfjs-dist/legacy/build/pdf.worker.js")

/* ================= BEDROCK ================= */

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "us-east-1",
})

const EMBED_MODEL_ID = "cohere.embed-english-v3"

/* ================= UTILS ================= */

const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms))

async function embedWithRetry(text: string, maxRetries = 3): Promise<number[]> {
  let attempt = 0
  while (attempt < maxRetries) {
    try {
      const embedRes = await bedrock.send(
        new InvokeModelCommand({
          modelId: EMBED_MODEL_ID,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify({
            texts: [text.slice(0, 2048)],
            input_type: "search_document",
          }),
        })
      )

      const embedJson = JSON.parse(
        Buffer.from(embedRes.body!).toString("utf-8")
      )

      const embedding = embedJson?.embeddings?.[0]
      if (!embedding) {
        throw new Error("No embedding in response")
      }

      return embedding
    } catch (err: any) {
      attempt++
      if (err?.name === "ThrottlingException" && attempt < maxRetries) {
        const wait = Math.min(1000 * attempt, 5000)
        console.warn(`Embedding throttled, retrying in ${wait}ms (attempt ${attempt})`)
        await sleep(wait)
        continue
      }
      throw err
    }
  }
  throw new Error("Embedding failed after retries")
}

/* ================= BATCH EMBEDDING ================= */

async function embedBatchWithRetry(texts: string[], maxRetries = 3): Promise<number[][]> {
  let attempt = 0
  while (attempt < maxRetries) {
    try {
      const embedRes = await bedrock.send(
        new InvokeModelCommand({
          modelId: EMBED_MODEL_ID,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify({
            texts: texts.map(t => t.slice(0, 2048)),
            input_type: "search_document",
          }),
        })
      )

      const embedJson = JSON.parse(
        Buffer.from(embedRes.body!).toString("utf-8")
      )

      const embeddings = embedJson?.embeddings
      if (!embeddings || embeddings.length !== texts.length) {
        throw new Error("Mismatched embedding count")
      }

      return embeddings
    } catch (err: any) {
      attempt++
      if (err?.name === "ThrottlingException" && attempt < maxRetries) {
        const wait = Math.min(1000 * attempt, 5000)
        console.warn(`Batch embedding throttled, retrying in ${wait}ms (attempt ${attempt})`)
        await sleep(wait)
        continue
      }
      throw err
    }
  }
  throw new Error("Batch embedding failed after retries")
}

/* ================= PARALLEL EMBEDDING WITH CONCURRENCY LIMIT ================= */

async function embedChunksParallel(
  chunks: Array<{ text: string; index: number }>,
  concurrency = 5,
  batchSize = 8 // Cohere supports up to 96, but use smaller batches for reliability
): Promise<Map<number, number[]>> {
  const results = new Map<number, number[]>()
  const errors = new Map<number, Error>()

  // Process chunks in batches with concurrency limit
  const processBatch = async (batchChunks: Array<{ text: string; index: number }>) => {
    try {
      const embeddings = await embedBatchWithRetry(batchChunks.map(c => c.text))
      batchChunks.forEach((chunk, idx) => {
        results.set(chunk.index, embeddings[idx])
      })
    } catch (err) {
      // Fallback to individual embedding for failed batch
      console.warn(`Batch embedding failed, falling back to individual embeddings for ${batchChunks.length} chunks`)
      await Promise.all(
        batchChunks.map(chunk =>
          embedWithRetry(chunk.text)
            .then(emb => results.set(chunk.index, emb))
            .catch(e => {
              errors.set(chunk.index, e as Error)
              console.error(`Failed to embed chunk ${chunk.index}:`, e)
            })
        )
      )
    }
  }

  // Process in parallel batches with concurrency limit
  const batches: Array<Array<{ text: string; index: number }>> = []
  for (let i = 0; i < chunks.length; i += batchSize) {
    batches.push(chunks.slice(i, i + batchSize))
  }

  // Process batches with concurrency limit
  for (let i = 0; i < batches.length; i += concurrency) {
    const concurrentBatches = batches.slice(i, i + concurrency)
    await Promise.all(concurrentBatches.map(batch => processBatch(batch)))
  }

  // Log any errors but don't fail completely
  if (errors.size > 0) {
    console.warn(`Failed to embed ${errors.size} chunks out of ${chunks.length}, continuing with ${results.size} successful embeddings...`)
  }

  return results
}

/* ================= NLP SETUP ================= */

const SentenceTokenizer =
  (natural as any).SentenceTokenizer ??
  (natural as any).sentenceTokenizer

const sentenceTokenizer = SentenceTokenizer
  ? new SentenceTokenizer()
  : null

/* ================= TYPES ================= */

type NormalizedRect = {
  left: number
  top: number
  width: number
  height: number
}

type Paragraph = {
  text: string
  rects: NormalizedRect[]
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/* ================= ROUTE ================= */

export async function POST(req: NextRequest) {
  console.log("UPLOAD ▶ multi-file request received")

  const results: {
    fileName: string
    sourceId?: string
    status: "ok" | "failed"
    error?: string
  }[] = []

  try {
    const form = await req.formData()

    const files = form.getAll("file") as File[]
    const projectId = form.get("project_id") as string | null
    const type = form.get("type") as string | null
    const titleBase = form.get("title") as string | null
    const userId = form.get("user_id") as string | null

    if (!files.length || !projectId || !type || !titleBase || !userId) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    }

    for (const file of files) {
      let sourceId: string | null = null

      try {
        if (file.type !== "application/pdf") {
          throw new Error("Only PDF allowed")
        }

        /* ================= STORE PDF ================= */

        sourceId = crypto.randomUUID()
        const path = `${projectId}/${sourceId}.pdf`

        const { error: storageError } = await supabaseAdmin.storage
          .from("sources")
          .upload(path, file, { contentType: "application/pdf" })

        if (storageError) throw storageError

        /* ================= CREATE SOURCE ================= */

        const title =
          files.length > 1
            ? `${titleBase} — ${file.name}`
            : titleBase

        const { data: source, error: sourceError } = await supabaseAdmin
          .from("project_sources")
          .insert({
            id: sourceId,
            project_id: projectId,
            type,
            title,
            uploaded_by: userId,
            storage_path: path,
            status: "pending",
          })
          .select()
          .single()

        if (sourceError || !source) {
          throw sourceError ?? new Error("Source insert failed")
        }

        /* ================= LOAD PDF ================= */

        const { data: fileData, error: downloadError } =
          await supabaseAdmin.storage.from("sources").download(path)

        if (downloadError || !fileData) {
          throw downloadError ?? new Error("Failed to download PDF")
        }

        const buffer = await fileData.arrayBuffer()

        const pdf = await (pdfjs as any).getDocument({
          data: buffer,
          disableWorker: true,
        }).promise

        let globalChunkIndex = 0
        let globalCharCursor = 0

        // Collect all chunks first
        const allChunks: Array<{
          text: string
          pageNum: number
          paragraphIndex: number
          rects: NormalizedRect[]
          charStart: number
          charEnd: number
          chunkIndex: number
        }> = []

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum)
          const viewport = page.getViewport({ scale: 1 })
          const textContent = await page.getTextContent()

          const paragraphs = normalizeParagraphs(
            textContent.items,
            viewport.width,
            viewport.height
          )

          const chunks = contextualChunkParagraphs(paragraphs)

          for (const chunk of chunks) {
            const text = chunk.text.trim()
            if (!text || text.length < 10) continue // Skip very short chunks

            const charStart = globalCharCursor
            const charEnd = globalCharCursor + text.length
            globalCharCursor = charEnd

            allChunks.push({
              text,
              pageNum,
              paragraphIndex: chunk.paragraph_index,
              rects: chunk.rects,
              charStart,
              charEnd,
              chunkIndex: globalChunkIndex++,
            })
          }
        }

        /* ================= BATCH EMBED ALL CHUNKS IN PARALLEL ================= */

        console.log(`Embedding ${allChunks.length} chunks in parallel...`)
        const chunksForEmbedding = allChunks.map((c, idx) => ({
          text: c.text,
          index: idx,
        }))

        const embeddingMap = await embedChunksParallel(chunksForEmbedding, 5, 10)

        /* ================= BATCH INSERT ALL CHUNKS ================= */

        const chunksToInsert = allChunks
          .map((chunk, idx) => {
            const embedding = embeddingMap.get(idx)
            if (!embedding) return null

            return {
              project_id: projectId,
              source_id: source.id,
              text: chunk.text,
              page_number: chunk.pageNum,
              paragraph_index: chunk.paragraphIndex,
              chunk_index: chunk.chunkIndex,
              char_start: chunk.charStart,
              char_end: chunk.charEnd,
              rects_json: chunk.rects,
              embedding,
              checksum: crypto
                .createHash("sha256")
                .update(chunk.text)
                .digest("hex"),
            }
          })
          .filter((c): c is NonNullable<typeof c> => c !== null)

        // Insert in batches of 100 to avoid payload size limits
        const BATCH_SIZE = 100
        for (let i = 0; i < chunksToInsert.length; i += BATCH_SIZE) {
          const batch = chunksToInsert.slice(i, i + BATCH_SIZE)
          const { error: insertError } = await supabaseAdmin
            .from("source_chunks")
            .insert(batch)

          if (insertError) {
            console.error(`Failed to insert batch ${i / BATCH_SIZE + 1}:`, insertError)
            // Try individual inserts as fallback
            for (const chunk of batch) {
              try {
                await supabaseAdmin.from("source_chunks").insert(chunk)
              } catch (err) {
                console.error(`Failed to insert chunk ${chunk.chunk_index}:`, err)
              }
            }
          }
        }

        console.log(`Inserted ${chunksToInsert.length} chunks`)

        /* ================= FINALIZE ================= */

        await supabaseAdmin
          .from("project_sources")
          .update({ status: "complete" })
          .eq("id", source.id)

        results.push({
          fileName: file.name,
          sourceId: source.id,
          status: "ok",
        })
      } catch (err: any) {
        console.error("UPLOAD ✗ file failed:", file.name, err)

        if (sourceId) {
          await supabaseAdmin
            .from("project_sources")
            .update({ status: "failed" })
            .eq("id", sourceId)
        }

        results.push({
          fileName: file.name,
          status: "failed",
          error: err?.message ?? "File processing error",
        })
      }
    }

    console.log("UPLOAD ✓ batch complete")
    return NextResponse.json({ ok: true, results })
  } catch (err: any) {
    console.error("UPLOAD ✗ fatal", err)
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    )
  }
}

/* ================= PARAGRAPH NORMALIZATION ================= */

function normalizeParagraphs(
  items: any[],
  pageWidth: number,
  pageHeight: number
): Paragraph[] {
  const paras: Paragraph[] = []
  let current: Paragraph = { text: "", rects: [] }
  
  // Track font sizes to detect headings
  const fontSizes: number[] = []
  let currentFontSize = 0

  for (const item of items) {
    const str = item.str as string
    if (!str || !str.trim()) {
      if (current.text.trim()) {
        paras.push(current)
        current = { text: "", rects: [] }
      }
      continue
    }

    const [x, y] = item.transform.slice(4, 6)
    const fontSize = item.transform[0] || 12 // Extract font size from transform matrix
    fontSizes.push(fontSize)
    currentFontSize = fontSize

    // Detect potential headings (larger font, centered, or all caps)
    const isPotentialHeading = 
      fontSize > 14 || // Larger font
      (str.length < 100 && /^[A-Z\s]+$/.test(str.trim())) || // All caps short text
      (Math.abs(x / pageWidth - 0.5) < 0.1 && str.length < 150) // Centered short text

    // Break paragraph on heading indicators
    if (isPotentialHeading && current.text.trim()) {
      paras.push(current)
      current = { text: "", rects: [] }
    }

    current.rects.push({
      left: x / pageWidth,
      width: item.width / pageWidth,
      top: 1 - (y + item.height) / pageHeight,
      height: item.height / pageHeight,
    })

    current.text += str + " "
  }

  if (current.text.trim()) paras.push(current)
  return paras
}

/* ================= IMPROVED CONTEXTUAL CHUNKING ================= */

function contextualChunkParagraphs(paragraphs: Paragraph[]) {
  const MAX_CHARS = 1000 // Slightly increased for better context
  const MIN_CHARS = 200 // Minimum chunk size
  const OVERLAP_CHARS = 150 // Overlap between chunks for better retrieval
  const MAX_CHUNK_CHARS = 1200 // Hard limit

  const chunks: {
    text: string
    rects: NormalizedRect[]
    paragraph_index: number
    isHeading?: boolean
  }[] = []

  let bufferText = ""
  let bufferRects: NormalizedRect[] = []
  let bufferStartPara = 0
  let lastChunkEndPara = -1

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    const paraText = p.text.trim()
    
    if (!paraText) continue

    // Detect headings (short paragraphs, all caps, or numbered sections)
    const isHeading = 
      paraText.length < 150 &&
      (/^[A-Z\s\d\.]+$/.test(paraText) || 
       /^\d+[\.\)]\s+[A-Z]/.test(paraText) ||
       /^(Chapter|Section|Part|Article)\s+\d+/i.test(paraText))

    const candidate = bufferText ? bufferText + " " + paraText : paraText

    // Check for topic breaks
    const topicBreak = bufferText && !isSemanticallyContinuous(bufferText, paraText)
    
    // Check for legal citation patterns (strong break indicators)
    const hasCitation = /\(\d{4}\)|\[\d{4}\]|v\.|v\s|See\s|Cf\.|Id\.|Supra|Infra/i.test(paraText)
    
    // Force break on headings (unless buffer is too small)
    const shouldBreakOnHeading = isHeading && bufferText.length >= MIN_CHARS

    // Force break on citations if buffer is substantial
    const shouldBreakOnCitation = hasCitation && bufferText.length >= MIN_CHARS * 1.5

    if (
      candidate.length > MAX_CHARS ||
      (topicBreak && bufferText.length >= MIN_CHARS) ||
      shouldBreakOnHeading ||
      shouldBreakOnCitation ||
      candidate.length > MAX_CHUNK_CHARS
    ) {
      // Save current chunk
      if (bufferText.trim()) {
        chunks.push({
          text: bufferText.trim(),
          rects: bufferRects,
          paragraph_index: bufferStartPara,
        })
        lastChunkEndPara = i - 1
      }

      // Start new chunk with overlap if possible
      if (i > 0 && OVERLAP_CHARS > 0) {
        const overlapStart = Math.max(bufferStartPara, lastChunkEndPara - 2)
        let overlapText = ""
        let overlapRects: NormalizedRect[] = []
        
        for (let j = overlapStart; j < i && j < paragraphs.length; j++) {
          const overlapPara = paragraphs[j]
          if (overlapText.length < OVERLAP_CHARS) {
            overlapText += (overlapText ? " " : "") + overlapPara.text.trim()
            overlapRects.push(...overlapPara.rects)
          }
        }
        
        if (overlapText) {
          bufferText = overlapText + " " + paraText
          bufferRects = [...overlapRects, ...p.rects]
          bufferStartPara = overlapStart
        } else {
          bufferText = paraText
          bufferRects = [...p.rects]
          bufferStartPara = i
        }
      } else {
        bufferText = paraText
        bufferRects = [...p.rects]
        bufferStartPara = i
      }
    } else {
      bufferText = candidate
      bufferRects.push(...p.rects)
    }
  }

  // Add final chunk
  if (bufferText.trim()) {
    chunks.push({
      text: bufferText.trim(),
      rects: bufferRects,
      paragraph_index: bufferStartPara,
    })
  }

  // Post-process: ensure no chunks are too small (merge with next)
  const finalChunks: typeof chunks = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    if (chunk.text.length < MIN_CHARS && i < chunks.length - 1) {
      // Merge small chunk with next
      const nextChunk = chunks[i + 1]
      finalChunks.push({
        text: chunk.text + " " + nextChunk.text,
        rects: [...chunk.rects, ...nextChunk.rects],
        paragraph_index: chunk.paragraph_index,
      })
      i++ // Skip next chunk as it's been merged
    } else {
      finalChunks.push(chunk)
    }
  }

  return finalChunks
}

/* ================= IMPROVED SEMANTIC CONTINUITY ================= */

function isSemanticallyContinuous(a: string, b: string) {
  const prev = a.trim()
  const next = b.trim()
  if (!prev || !next) return true

  // Strong break indicators (definitely not continuous)
  const strongBreakPatterns = [
    /^[A-Z][A-Z\s]{10,}$/, // All caps heading
    /^\d+[\.\)]\s+[A-Z]/, // Numbered section
    /^(Chapter|Section|Part|Article|Subsection)\s+\d+/i, // Explicit section markers
    /^Table\s+\d+/i, // Table reference
    /^Figure\s+\d+/i, // Figure reference
    /^Appendix\s+[A-Z\d]/i, // Appendix
  ]

  for (const pattern of strongBreakPatterns) {
    if (pattern.test(next)) return false
  }

  // Check sentence completion
  if (sentenceTokenizer) {
    try {
      const sents = sentenceTokenizer.tokenize(prev)
      const last = sents[sents.length - 1] || ""
      if (!/[.!?]$/.test(last)) return true
    } catch {}
  } else {
    if (!/[.!?]$/.test(prev)) return true
  }

  // Continuation indicators (definitely continuous)
  if (/^[a-z]/.test(next)) return true

  const continuationWords = [
    /^(and|or|but|which|that|because|however|therefore|thus|whereas|furthermore|moreover|additionally|also|similarly|likewise|conversely|nevertheless|nonetheless|accordingly|consequently|hence|thus|indeed|specifically|particularly|notably)\b/i
  ]

  for (const pattern of continuationWords) {
    if (pattern.test(next)) return true
  }

  // Legal citation patterns (usually indicate new topic)
  const legalCitationPatterns = [
    /\(\d{4}\)/, // Year in parentheses
    /\[\d{4}\]/, // Year in brackets
    /v\.|v\s/, // Case citation
    /^See\s/, // See citation
    /^Cf\./, // Compare citation
    /^Id\./, // Id citation
    /^Supra/, // Supra citation
    /^Infra/, // Infra citation
  ]

  for (const pattern of legalCitationPatterns) {
    if (pattern.test(next) && prev.length > 100) {
      // Citation after substantial text likely indicates new topic
      return false
    }
  }

  // List indicators (usually continuous)
  if (/^\(?[a-zivx]+\)/i.test(next) || /^\d+(\.\d+)*\s/.test(next))
    return true

  // Token overlap analysis
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/\W+/)
        .filter(w => w.length > 2)
    )

  const A = tokenize(prev)
  const B = tokenize(next)

  let overlap = 0
  for (const t of A) if (B.has(t)) overlap++

  const overlapRatio = overlap / Math.max(1, Math.min(A.size, B.size))
  
  // Higher threshold for continuity (more strict)
  if (overlapRatio > 0.25) return true

  // Noun overlap analysis
  try {
    const na = nlp(prev).nouns().out("array") as string[]
    const nb = nlp(next).nouns().out("array") as string[]

    if (na.length > 0 && nb.length > 0) {
      const nounSet = new Set(na.map(n => n.toLowerCase()))
      let nounOverlap = 0
      for (const n of nb) {
        if (nounSet.has(n.toLowerCase())) nounOverlap++
      }
      
      // If significant noun overlap, likely continuous
      if (nounOverlap / Math.max(na.length, nb.length) > 0.3) {
        return true
      }
    }
  } catch {}

  // Default to not continuous if no strong indicators
  return false
}
