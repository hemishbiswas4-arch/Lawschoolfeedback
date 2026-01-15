// =======================================================
// FILE: app/api/sources/upload/route.ts
// PURPOSE:
//   - Upload PDFs
//   - Chunk text
//   - Embed every chunk (Cohere via Bedrock)
//   - Store vectorized chunks for retrieval
// =======================================================

export const runtime = "nodejs"
export const maxDuration = 300 // 5 minutes for large file processing

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
  concurrency = 10,
  batchSize = 50 // Cohere supports up to 96, increased for better throughput
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
    errorCode?: string
    suggestions?: string[]
  }[] = []

  try {
    const form = await req.formData()

    const files = form.getAll("file") as File[]
    const projectId = form.get("project_id") as string | null
    const type = form.get("type") as string | null
    const titleBase = form.get("title") as string | null
    const userId = form.get("user_id") as string | null

    // Enhanced validation with specific error messages
    if (!files.length) {
      return NextResponse.json(
        {
          error: "No files provided",
          errorCode: "NO_FILES",
          suggestions: [
            "Please select at least one PDF file to upload",
            "Ensure your files are in PDF format",
            "Try refreshing the page and selecting files again"
          ]
        },
        { status: 400 }
      )
    }

    if (!projectId) {
      return NextResponse.json(
        {
          error: "Project ID is required",
          errorCode: "MISSING_PROJECT_ID",
          suggestions: [
            "Please ensure you're uploading to a valid project",
            "Try refreshing the page and selecting the project again"
          ]
        },
        { status: 400 }
      )
    }

    if (!type) {
      return NextResponse.json(
        {
          error: "Source type is required",
          errorCode: "MISSING_TYPE",
          suggestions: [
            "Please select a source type from the dropdown menu",
            "Choose the category that best describes your document"
          ]
        },
        { status: 400 }
      )
    }

    if (!titleBase || !titleBase.trim()) {
      return NextResponse.json(
        {
          error: "Title is required",
          errorCode: "MISSING_TITLE",
          suggestions: [
            "Please enter a title for your source(s)",
            "For multiple files, enter a base title (e.g., 'Supreme Court Cases')",
            "For single files, enter the document title"
          ]
        },
        { status: 400 }
      )
    }

    if (!userId) {
      return NextResponse.json(
        {
          error: "User authentication required",
          errorCode: "MISSING_USER",
          suggestions: [
            "Please log in again",
            "Your session may have expired - try refreshing the page"
          ]
        },
        { status: 401 }
      )
    }

    // Verify project ownership before allowing upload
    const { data: project, error: projectError } = await supabaseAdmin
      .from("projects")
      .select("id, owner_id")
      .eq("id", projectId)
      .eq("owner_id", userId)
      .single()

    if (projectError || !project) {
      return NextResponse.json(
        {
          error: "Project not found or access denied",
          errorCode: "PROJECT_ACCESS_DENIED",
          suggestions: [
            "Ensure you have permission to upload to this project",
            "Check that the project exists and you are the owner",
            "Try refreshing the page"
          ]
        },
        { status: 403 }
      )
    }

    // Process files in parallel with concurrency limit for better performance
    const CONCURRENCY_LIMIT = 3 // Process 3 files at a time to balance speed and memory
    const fileBatches: File[][] = []
    for (let i = 0; i < files.length; i += CONCURRENCY_LIMIT) {
      fileBatches.push(files.slice(i, i + CONCURRENCY_LIMIT))
    }

    for (const batch of fileBatches) {
      await Promise.all(batch.map(async (file) => {
        let sourceId: string | null = null

        try {
          // Enhanced file validation
          if (file.type !== "application/pdf") {
            throw {
              message: `File "${file.name}" is not a PDF file`,
              errorCode: "INVALID_FILE_TYPE",
              suggestions: [
                "Only PDF files are supported",
                "Convert your file to PDF format before uploading",
                "Ensure the file extension is .pdf"
              ]
            }
          }

          // Check file size (increased to 200MB)
          const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB
          if (file.size > MAX_FILE_SIZE) {
            throw {
              message: `File "${file.name}" exceeds the 200MB size limit (${(file.size / 1024 / 1024).toFixed(2)}MB)`,
              errorCode: "FILE_TOO_LARGE",
              suggestions: [
                "Split large PDFs into smaller files",
                "Compress the PDF using a PDF compression tool",
                "Remove unnecessary pages or images from the document",
                "Contact support if you need to upload larger files"
              ]
            }
          }

          if (file.size < 100) {
            throw {
              message: `File "${file.name}" appears to be empty or corrupted`,
              errorCode: "FILE_CORRUPTED",
              suggestions: [
                "Ensure the file is not empty",
                "Try re-saving or re-exporting the PDF",
                "Check that the file downloaded completely"
              ]
            }
          }

        /* ================= STORE PDF ================= */

        sourceId = crypto.randomUUID()
        const path = `${projectId}/${sourceId}.pdf`

          const { error: storageError } = await supabaseAdmin.storage
            .from("sources")
            .upload(path, file, {
              contentType: "application/pdf",
              upsert: false, // Don't overwrite existing files
            })

          if (storageError) {
            if (storageError.message?.includes("already exists")) {
              throw {
                message: `File "${file.name}" already exists in storage`,
                errorCode: "FILE_EXISTS",
                suggestions: [
                  "Try renaming the file before uploading",
                  "Delete the existing file first if you want to replace it"
                ]
              }
            }
            throw {
              message: `Storage error: ${storageError.message}`,
              errorCode: "STORAGE_ERROR",
              suggestions: [
                "Check your internet connection",
                "Try uploading again in a few moments",
                "If the problem persists, contact support"
              ]
            }
          }

        /* ================= CREATE SOURCE ================= */

          const title =
            files.length > 1
              ? `${titleBase.trim()} — ${file.name}`
              : titleBase.trim()

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
            throw {
              message: `Database error: ${sourceError?.message || "Source insert failed"}`,
              errorCode: "DATABASE_ERROR",
              suggestions: [
                "Try uploading again",
                "Check that the project still exists",
                "If the problem persists, contact support"
              ]
            }
          }

          /* ================= LOAD PDF ================= */

          const { data: fileData, error: downloadError } =
            await supabaseAdmin.storage.from("sources").download(path)

          if (downloadError || !fileData) {
            throw {
              message: `Failed to download PDF: ${downloadError?.message || "Unknown error"}`,
              errorCode: "DOWNLOAD_ERROR",
              suggestions: [
                "The file may have been corrupted during upload",
                "Try uploading the file again",
                "Check your internet connection"
              ]
            }
          }

          const buffer = await fileData.arrayBuffer()

          let pdf
          try {
            pdf = await (pdfjs as any).getDocument({
              data: buffer,
              disableWorker: true,
              verbosity: 0, // Reduce logging for performance
            }).promise
          } catch (pdfError: any) {
            throw {
              message: `Failed to parse PDF: ${pdfError?.message || "PDF may be corrupted or encrypted"}`,
              errorCode: "PDF_PARSE_ERROR",
              suggestions: [
                "Ensure the PDF is not password-protected",
                "Try re-saving the PDF in a different PDF viewer",
                "Check that the PDF is not corrupted",
                "If the PDF is scanned, ensure it has been OCR'd properly"
              ]
            }
          }

        let globalChunkIndex = 0
        let globalCharCursor = 0

        // Collect all chunks first - process pages in parallel for better performance
        const allChunks: Array<{
          text: string
          pageNum: number
          paragraphIndex: number
          rects: NormalizedRect[]
          charStart: number
          charEnd: number
          chunkIndex: number
        }> = []

        // Process pages in parallel batches of 5 for memory efficiency
        const PAGE_BATCH_SIZE = 5
        for (let pageStart = 1; pageStart <= pdf.numPages; pageStart += PAGE_BATCH_SIZE) {
          const pageEnd = Math.min(pageStart + PAGE_BATCH_SIZE - 1, pdf.numPages)
          const pagePromises = []

          for (let pageNum = pageStart; pageNum <= pageEnd; pageNum++) {
            pagePromises.push(
              pdf.getPage(pageNum).then(async (page: any) => {
                const viewport = page.getViewport({ scale: 1 })
                const textContent = await page.getTextContent()

                const paragraphs = normalizeParagraphs(
                  textContent.items,
                  viewport.width,
                  viewport.height
                )

                const chunks = contextualChunkParagraphs(paragraphs)

                return { pageNum, chunks }
              })
            )
          }

          const pageResults = await Promise.all(pagePromises)

          // Process results in page order
          pageResults.sort((a, b) => a.pageNum - b.pageNum)

          for (const { pageNum, chunks } of pageResults) {
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
        }

        /* ================= BATCH EMBED ALL CHUNKS IN PARALLEL ================= */

        console.log(`Processing ${allChunks.length} chunks (larger chunks = fewer embeddings)...`)
        const chunksForEmbedding = allChunks.map((c, idx) => ({
          text: c.text,
          index: idx,
        }))

        const embeddingMap = await embedChunksParallel(chunksForEmbedding)

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

        // Insert in batches of 500 to avoid payload size limits
        const BATCH_SIZE = 500
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
            try {
              await supabaseAdmin
                .from("project_sources")
                .update({ status: "failed" })
                .eq("id", sourceId)
            } catch (updateErr) {
              console.error("Failed to update source status:", updateErr)
            }
          }

          // Clean up storage if source was created but processing failed
          if (sourceId) {
            try {
              await supabaseAdmin.storage
                .from("sources")
                .remove([`${projectId}/${sourceId}.pdf`])
            } catch (cleanupErr) {
              console.error("Failed to cleanup storage:", cleanupErr)
            }
          }

          results.push({
            fileName: file.name,
            status: "failed",
            error: err?.message ?? err?.toString() ?? "File processing error",
            errorCode: err?.errorCode || "UNKNOWN_ERROR",
            suggestions: err?.suggestions || [
              "Try uploading the file again",
              "Check that the file is a valid PDF",
              "If the problem persists, contact support"
            ],
          })
        }
      }))
    }

    console.log("UPLOAD ✓ batch complete")
    return NextResponse.json({ ok: true, results })
  } catch (err: any) {
    console.error("UPLOAD ✗ fatal", err)
    return NextResponse.json(
      {
        error: err?.message ?? "Server error",
        errorCode: err?.errorCode || "SERVER_ERROR",
        suggestions: err?.suggestions || [
          "Try uploading again in a few moments",
          "Check your internet connection",
          "If the problem persists, contact support"
        ]
      },
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

/* ================= SEMANTIC CHUNKING WITH LEGAL REASONING PRESERVATION ================= */

function detectLegalReasoningPatterns(text: string): string[] {
  const patterns: string[] = []
  const lowerText = text.toLowerCase()

  // IRAC and similar structures
  if (/\b(issue|question|problem)\b.*?\b(is|are|was|were)\b/i.test(text)) {
    patterns.push("issue_statement")
  }
  if (/\b(rule|law|standard|test|principle)\b.*?\b(is|are|requires|provides|states)\b/i.test(text)) {
    patterns.push("rule_statement")
  }
  if (/\b(application|analysis|applying|appraisal)\b.*?\b(to|of)\b/i.test(text)) {
    patterns.push("application_analysis")
  }
  if (/\b(conclusion|result|outcome|therefore|thus|hence|accordingly)\b/i.test(text)) {
    patterns.push("conclusion")
  }

  // Legal argument connectors
  if (/\b(moreover|furthermore|additionally|in addition)\b/i.test(text)) {
    patterns.push("argument_extension")
  }
  if (/\b(however|nevertheless|notwithstanding|despite|although)\b/i.test(text)) {
    patterns.push("counter_argument")
  }
  if (/\b(therefore|consequently|thus|hence|accordingly|as a result)\b/i.test(text)) {
    patterns.push("logical_conclusion")
  }

  // Legal definitions and exceptions
  if (/\b(means|shall mean|is defined as|definition)\b/i.test(text)) {
    patterns.push("definition")
  }
  if (/\b(except|unless|provided that|notwithstanding|subject to)\b/i.test(text)) {
    patterns.push("exception_qualifier")
  }

  // Citation and authority patterns
  if (/\b(see|see also|cf|compare|contra)\b/i.test(text)) {
    patterns.push("citation_reference")
  }
  if (/\b(pursuant to|in accordance with|under|per)\b/i.test(text)) {
    patterns.push("authority_reference")
  }

  return patterns
}

function contextualChunkParagraphs(paragraphs: Paragraph[]) {
  const MAX_CHARS = 1500 // Increased for better context and fewer chunks
  const MIN_CHARS = 300 // Increased minimum for more substantial chunks
  const OVERLAP_CHARS = 200 // Increased overlap for better retrieval
  const MAX_CHUNK_CHARS = 1800 // Hard limit increased proportionally

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

    // Enhanced break detection: break before major legal reasoning shifts
    const bufferPatterns = bufferText ? detectLegalReasoningPatterns(bufferText) : []
    const paraPatterns = detectLegalReasoningPatterns(paraText)
    const reasoningShift = paraPatterns.some((pattern: string) =>
      ['issue_statement', 'rule_statement', 'conclusion', 'definition'].includes(pattern) &&
      !bufferPatterns.some(bp => bp === pattern) &&
      bufferText.length >= MIN_CHARS
    )

    if (
      candidate.length > MAX_CHARS ||
      (topicBreak && bufferText.length >= MIN_CHARS) ||
      shouldBreakOnHeading ||
      shouldBreakOnCitation ||
      reasoningShift ||
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

  // Noun overlap analysis (keeping original NLP logic for quality)
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
