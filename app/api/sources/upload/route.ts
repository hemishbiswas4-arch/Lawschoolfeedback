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
  isHeading?: boolean
  headingLevel?: number
  sectionNumber?: string
}

type ChunkMetadata = {
  section_header?: string
  case_citations?: string[]
  statute_references?: string[]
  detected_patterns?: string[]
  heading_context?: string
}

/* ================= DOCUMENT TYPE CHUNKING CONFIGURATION ================= */

type ChunkConfig = {
  MAX_CHARS: number
  MIN_CHARS: number
  OVERLAP_CHARS: number
  MAX_CHUNK_CHARS: number
  preserveIRAC: boolean
  preserveStatuteSections: boolean
}

const CHUNK_CONFIGS: Record<string, ChunkConfig> = {
  // Case law: preserve IRAC structure, larger chunks for reasoning
  case: {
    MAX_CHARS: 1800,
    MIN_CHARS: 400,
    OVERLAP_CHARS: 300,
    MAX_CHUNK_CHARS: 2200,
    preserveIRAC: true,
    preserveStatuteSections: false,
  },
  // Statutes: chunk by section/subsection, smaller more precise chunks
  statute: {
    MAX_CHARS: 1200,
    MIN_CHARS: 200,
    OVERLAP_CHARS: 150,
    MAX_CHUNK_CHARS: 1500,
    preserveIRAC: false,
    preserveStatuteSections: true,
  },
  regulation: {
    MAX_CHARS: 1200,
    MIN_CHARS: 200,
    OVERLAP_CHARS: 150,
    MAX_CHUNK_CHARS: 1500,
    preserveIRAC: false,
    preserveStatuteSections: true,
  },
  constitution: {
    MAX_CHARS: 1200,
    MIN_CHARS: 200,
    OVERLAP_CHARS: 150,
    MAX_CHUNK_CHARS: 1500,
    preserveIRAC: false,
    preserveStatuteSections: true,
  },
  treaty: {
    MAX_CHARS: 1400,
    MIN_CHARS: 300,
    OVERLAP_CHARS: 200,
    MAX_CHUNK_CHARS: 1800,
    preserveIRAC: false,
    preserveStatuteSections: true,
  },
  // Academic papers: larger chunks for argument flow
  journal_article: {
    MAX_CHARS: 1600,
    MIN_CHARS: 350,
    OVERLAP_CHARS: 250,
    MAX_CHUNK_CHARS: 2000,
    preserveIRAC: false,
    preserveStatuteSections: false,
  },
  book: {
    MAX_CHARS: 1600,
    MIN_CHARS: 350,
    OVERLAP_CHARS: 250,
    MAX_CHUNK_CHARS: 2000,
    preserveIRAC: false,
    preserveStatuteSections: false,
  },
  commentary: {
    MAX_CHARS: 1500,
    MIN_CHARS: 300,
    OVERLAP_CHARS: 200,
    MAX_CHUNK_CHARS: 1900,
    preserveIRAC: false,
    preserveStatuteSections: false,
  },
  // Default for unknown types
  default: {
    MAX_CHARS: 1500,
    MIN_CHARS: 300,
    OVERLAP_CHARS: 200,
    MAX_CHUNK_CHARS: 1800,
    preserveIRAC: false,
    preserveStatuteSections: false,
  },
}

/* ================= METADATA EXTRACTION ================= */

function extractCaseCitations(text: string): string[] {
  const citations: string[] = []
  
  // Common case citation patterns
  const patterns = [
    // US style: Name v. Name, 123 F.3d 456 (Cir. Year)
    /[A-Z][a-zA-Z\s,.']+\s+v\.?\s+[A-Z][a-zA-Z\s,.']+,\s*\d+\s+[A-Z][a-zA-Z.]+\s*\d*\s+\d+\s*\([^)]+\d{4}\)/g,
    // UK style: [Year] Court Vol (Party v Party)
    /\[\d{4}\]\s+[A-Z]+\s+\d+/g,
    // Simple v. pattern with year
    /[A-Z][a-zA-Z\s]+\s+v\.?\s+[A-Z][a-zA-Z\s]+\s*\(\d{4}\)/g,
    // Neutral citations: [Year] COURT Number
    /\[\d{4}\]\s+[A-Z]{2,}\s+\d+/g,
  ]
  
  for (const pattern of patterns) {
    const matches = text.match(pattern) || []
    citations.push(...matches.map(m => m.trim()))
  }
  
  return [...new Set(citations)].slice(0, 10) // Dedupe and limit
}

function extractStatuteReferences(text: string): string[] {
  const refs: string[] = []
  
  const patterns = [
    // US Code: 42 U.S.C. § 1983
    /\d+\s+U\.?S\.?C\.?\s*§\s*\d+[a-z]*/gi,
    // Section references: Section 4, s. 4, § 4
    /(?:Section|§|s\.)\s*\d+(?:\(\d+\))?(?:\([a-z]\))?/gi,
    // Article references
    /Article\s+\d+(?:\(\d+\))?/gi,
    // Part/Chapter references
    /(?:Part|Chapter)\s+[IVXLCDM\d]+/gi,
    // Act references: The Something Act 2020
    /The\s+[A-Z][a-zA-Z\s]+Act\s+\d{4}/g,
  ]
  
  for (const pattern of patterns) {
    const matches = text.match(pattern) || []
    refs.push(...matches.map(m => m.trim()))
  }
  
  return [...new Set(refs)].slice(0, 10)
}

function extractSectionHeader(text: string): string | undefined {
  // Look for section headers at the start of text
  const headerPatterns = [
    /^(?:Section|Article|Part|Chapter)\s+[\dIVXLCDM]+[:\.\s]+([^\n]{1,100})/i,
    /^(\d+(?:\.\d+)*)\s+([A-Z][^\n]{1,100})/,
    /^([IVXLCDM]+)\.\s+([A-Z][^\n]{1,100})/,
    /^([A-Z][A-Z\s]{5,50})$/m, // All caps heading
  ]
  
  for (const pattern of headerPatterns) {
    const match = text.match(pattern)
    if (match) {
      return match[0].trim().slice(0, 150)
    }
  }
  
  return undefined
}

function extractChunkMetadata(text: string, paragraphs: Paragraph[]): ChunkMetadata {
  const metadata: ChunkMetadata = {}
  
  // Extract case citations
  const caseCitations = extractCaseCitations(text)
  if (caseCitations.length > 0) {
    metadata.case_citations = caseCitations
  }
  
  // Extract statute references
  const statuteRefs = extractStatuteReferences(text)
  if (statuteRefs.length > 0) {
    metadata.statute_references = statuteRefs
  }
  
  // Extract section header
  const sectionHeader = extractSectionHeader(text)
  if (sectionHeader) {
    metadata.section_header = sectionHeader
  }
  
  // Detect legal reasoning patterns
  const patterns = detectLegalReasoningPatterns(text)
  if (patterns.length > 0) {
    metadata.detected_patterns = patterns
  }
  
  // Get heading context from paragraphs
  const headingPara = paragraphs.find(p => p.isHeading)
  if (headingPara) {
    metadata.heading_context = headingPara.text.trim().slice(0, 150)
  }
  
  return metadata
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

        // Get document type for type-aware chunking
        const docType = type || "default"
        console.log(`UPLOAD ▶ Processing with document type: ${docType}`)

        // Collect all chunks first - process pages in parallel for better performance
        const allChunks: Array<{
          text: string
          pageNum: number
          paragraphIndex: number
          rects: NormalizedRect[]
          charStart: number
          charEnd: number
          chunkIndex: number
          metadata?: ChunkMetadata
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

                // Use document-type-aware chunking
                const chunks = contextualChunkParagraphs(paragraphs, docType)

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
                metadata: chunk.metadata,
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
                // Store extracted metadata for improved retrieval
                metadata_json: chunk.metadata ? {
                  section_header: chunk.metadata.section_header,
                  case_citations: chunk.metadata.case_citations,
                  statute_references: chunk.metadata.statute_references,
                  detected_patterns: chunk.metadata.detected_patterns,
                  heading_context: chunk.metadata.heading_context,
                } : null,
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
  let current: Paragraph = { text: "", rects: [], isHeading: false }
  
  // Track font sizes to detect headings
  const fontSizes: number[] = []
  let currentFontSize = 0
  let avgFontSize = 12

  // First pass: collect font sizes to determine average
  for (const item of items) {
    if (item.transform && item.transform[0]) {
      fontSizes.push(item.transform[0])
    }
  }
  if (fontSizes.length > 0) {
    avgFontSize = fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length
  }

  for (const item of items) {
    const str = item.str as string
    if (!str || !str.trim()) {
      if (current.text.trim()) {
        paras.push(current)
        current = { text: "", rects: [], isHeading: false }
      }
      continue
    }

    const [x, y] = item.transform.slice(4, 6)
    const fontSize = item.transform[0] || 12
    currentFontSize = fontSize

    // Enhanced heading detection with levels
    const isLargerFont = fontSize > avgFontSize * 1.15
    const isAllCaps = str.length < 100 && /^[A-Z\s\d]+$/.test(str.trim()) && str.trim().length > 3
    const isCentered = Math.abs(x / pageWidth - 0.5) < 0.15 && str.length < 150
    const isNumberedSection = /^(?:\d+\.|\([a-z]\)|\([ivx]+\)|[IVXLCDM]+\.|Article|Section|Part|Chapter)\s/i.test(str.trim())
    
    const isPotentialHeading = isLargerFont || isAllCaps || (isCentered && str.length < 100) || isNumberedSection
    
    // Determine heading level (1 = major, 2 = medium, 3 = minor)
    let headingLevel: number | undefined
    if (isPotentialHeading) {
      if (fontSize > avgFontSize * 1.4 || /^(CHAPTER|PART|ARTICLE)\s/i.test(str.trim())) {
        headingLevel = 1
      } else if (fontSize > avgFontSize * 1.2 || /^(Section|\d+\.)\s/i.test(str.trim())) {
        headingLevel = 2
      } else {
        headingLevel = 3
      }
    }

    // Extract section number if present
    let sectionNumber: string | undefined
    const sectionMatch = str.trim().match(/^((?:\d+\.)+\d*|[IVXLCDM]+|\([a-z]\)|\([ivx]+\))\s/i)
    if (sectionMatch) {
      sectionNumber = sectionMatch[1]
    }

    // Break paragraph on heading indicators
    if (isPotentialHeading && current.text.trim()) {
      paras.push(current)
      current = { text: "", rects: [], isHeading: true, headingLevel, sectionNumber }
    }

    current.rects.push({
      left: x / pageWidth,
      width: item.width / pageWidth,
      top: 1 - (y + item.height) / pageHeight,
      height: item.height / pageHeight,
    })

    current.text += str + " "
    
    // Mark current paragraph as heading if detected
    if (isPotentialHeading) {
      current.isHeading = true
      current.headingLevel = headingLevel
      if (sectionNumber) current.sectionNumber = sectionNumber
    }
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

function contextualChunkParagraphs(paragraphs: Paragraph[], docType: string = "default") {
  // Get document-type-specific configuration
  const config = CHUNK_CONFIGS[docType] || CHUNK_CONFIGS.default
  const { MAX_CHARS, MIN_CHARS, OVERLAP_CHARS, MAX_CHUNK_CHARS, preserveIRAC, preserveStatuteSections } = config

  const chunks: {
    text: string
    rects: NormalizedRect[]
    paragraph_index: number
    isHeading?: boolean
    metadata?: ChunkMetadata
    paragraphs?: Paragraph[] // Keep track of source paragraphs for metadata
  }[] = []

  let bufferText = ""
  let bufferRects: NormalizedRect[] = []
  let bufferParagraphs: Paragraph[] = []
  let bufferStartPara = 0
  let lastChunkEndPara = -1
  let currentIRACPhase: string | null = null

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    const paraText = p.text.trim()
    
    if (!paraText) continue

    // Use paragraph's heading detection
    const isHeading = p.isHeading || (
      paraText.length < 150 &&
      (/^[A-Z\s\d\.]+$/.test(paraText) || 
       /^\d+[\.\)]\s+[A-Z]/.test(paraText) ||
       /^(Chapter|Section|Part|Article)\s+\d+/i.test(paraText))
    )

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
    
    // IRAC-aware chunking for case law
    let iracPhaseShift = false
    if (preserveIRAC) {
      const newIRACPhase = detectIRACPhase(paraText)
      if (newIRACPhase && currentIRACPhase && newIRACPhase !== currentIRACPhase && bufferText.length >= MIN_CHARS) {
        iracPhaseShift = true
      }
      if (newIRACPhase) {
        currentIRACPhase = newIRACPhase
      }
    }
    
    // Statute section-aware chunking
    let statuteSectionBreak = false
    if (preserveStatuteSections) {
      const hasNewSection = /^(?:Section|§|Article|Part)\s+\d+/i.test(paraText) || 
                           /^\(\d+\)\s/.test(paraText) ||
                           /^\d+\.\s+[A-Z]/.test(paraText)
      if (hasNewSection && bufferText.length >= MIN_CHARS * 0.5) {
        statuteSectionBreak = true
      }
    }
    
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
      iracPhaseShift ||
      statuteSectionBreak ||
      candidate.length > MAX_CHUNK_CHARS
    ) {
      // Save current chunk with metadata
      if (bufferText.trim()) {
        const metadata = extractChunkMetadata(bufferText.trim(), bufferParagraphs)
        chunks.push({
          text: bufferText.trim(),
          rects: bufferRects,
          paragraph_index: bufferStartPara,
          metadata,
          paragraphs: bufferParagraphs,
        })
        lastChunkEndPara = i - 1
      }

      // Start new chunk with overlap if possible
      if (i > 0 && OVERLAP_CHARS > 0) {
        const overlapStart = Math.max(bufferStartPara, lastChunkEndPara - 2)
        let overlapText = ""
        let overlapRects: NormalizedRect[] = []
        let overlapParagraphs: Paragraph[] = []
        
        for (let j = overlapStart; j < i && j < paragraphs.length; j++) {
          const overlapPara = paragraphs[j]
          if (overlapText.length < OVERLAP_CHARS) {
            overlapText += (overlapText ? " " : "") + overlapPara.text.trim()
            overlapRects.push(...overlapPara.rects)
            overlapParagraphs.push(overlapPara)
          }
        }
        
        if (overlapText) {
          bufferText = overlapText + " " + paraText
          bufferRects = [...overlapRects, ...p.rects]
          bufferParagraphs = [...overlapParagraphs, p]
          bufferStartPara = overlapStart
        } else {
          bufferText = paraText
          bufferRects = [...p.rects]
          bufferParagraphs = [p]
          bufferStartPara = i
        }
      } else {
        bufferText = paraText
        bufferRects = [...p.rects]
        bufferParagraphs = [p]
        bufferStartPara = i
      }
    } else {
      bufferText = candidate
      bufferRects.push(...p.rects)
      bufferParagraphs.push(p)
    }
  }

  // Add final chunk with metadata
  if (bufferText.trim()) {
    const metadata = extractChunkMetadata(bufferText.trim(), bufferParagraphs)
    chunks.push({
      text: bufferText.trim(),
      rects: bufferRects,
      paragraph_index: bufferStartPara,
      metadata,
      paragraphs: bufferParagraphs,
    })
  }

  // Post-process: ensure no chunks are too small (merge with next)
  const finalChunks: typeof chunks = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    if (chunk.text.length < MIN_CHARS && i < chunks.length - 1) {
      // Merge small chunk with next
      const nextChunk = chunks[i + 1]
      const mergedText = chunk.text + " " + nextChunk.text
      const mergedParagraphs = [...(chunk.paragraphs || []), ...(nextChunk.paragraphs || [])]
      const mergedMetadata = extractChunkMetadata(mergedText, mergedParagraphs)
      finalChunks.push({
        text: mergedText,
        rects: [...chunk.rects, ...nextChunk.rects],
        paragraph_index: chunk.paragraph_index,
        metadata: mergedMetadata,
        paragraphs: mergedParagraphs,
      })
      i++ // Skip next chunk as it's been merged
    } else {
      finalChunks.push(chunk)
    }
  }

  return finalChunks
}

/* ================= IRAC PHASE DETECTION ================= */

function detectIRACPhase(text: string): string | null {
  const lowerText = text.toLowerCase()
  
  // Issue indicators
  if (/\b(issue|question|matter|problem)\s+(is|before|presented|to be decided)/i.test(text) ||
      /\bwhether\b.*\?/i.test(text)) {
    return "issue"
  }
  
  // Rule indicators
  if (/\b(rule|law|standard|test|principle|doctrine)\s+(is|provides|states|requires)/i.test(text) ||
      /\bunder\s+(the\s+)?\w+\s+(act|statute|law|rule)/i.test(text) ||
      /\b(established|settled|well-established)\s+(law|principle|rule)/i.test(text)) {
    return "rule"
  }
  
  // Application indicators
  if (/\b(applying|application|here|in this case|in the present case)/i.test(text) ||
      /\bthe\s+(facts|evidence|record)\s+(shows?|demonstrates?|indicates?)/i.test(text)) {
    return "application"
  }
  
  // Conclusion indicators
  if (/\b(therefore|accordingly|thus|hence|we (hold|conclude|find)|it is (held|concluded)|in conclusion)/i.test(text) ||
      /\b(affirmed|reversed|remanded|dismissed|granted|denied)\b/i.test(text)) {
    return "conclusion"
  }
  
  return null
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
