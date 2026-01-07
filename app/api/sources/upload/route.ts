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
            if (!text) continue

            /* ================= EMBED ================= */

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
              throw new Error("Embedding failed")
            }

            const charStart = globalCharCursor
            const charEnd = globalCharCursor + text.length
            globalCharCursor = charEnd

            await supabaseAdmin.from("source_chunks").insert({
              project_id: projectId,
              source_id: source.id,
              text,
              page_number: pageNum,
              paragraph_index: chunk.paragraph_index,
              chunk_index: globalChunkIndex++,
              char_start: charStart,
              char_end: charEnd,
              rects_json: chunk.rects,
              embedding,
              checksum: crypto
                .createHash("sha256")
                .update(text)
                .digest("hex"),
            })
          }
        }

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

  for (const item of items) {
    const str = item.str as string
    const [x, y] = item.transform.slice(4, 6)

    if (!str.trim()) {
      if (current.text.trim()) {
        paras.push(current)
        current = { text: "", rects: [] }
      }
      continue
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

/* ================= CONTEXTUAL CHUNKING ================= */

function contextualChunkParagraphs(paragraphs: Paragraph[]) {
  const MAX_CHARS = 900
  const MIN_CHARS = 250

  const chunks: {
    text: string
    rects: NormalizedRect[]
    paragraph_index: number
  }[] = []

  let bufferText = ""
  let bufferRects: NormalizedRect[] = []
  let bufferStartPara = 0

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    const candidate = bufferText + " " + p.text

    const topicBreak =
      bufferText && !isSemanticallyContinuous(bufferText, p.text)

    if (
      candidate.length > MAX_CHARS ||
      (topicBreak && bufferText.length >= MIN_CHARS)
    ) {
      chunks.push({
        text: bufferText.trim(),
        rects: bufferRects,
        paragraph_index: bufferStartPara,
      })

      bufferText = p.text
      bufferRects = [...p.rects]
      bufferStartPara = i
    } else {
      bufferText = candidate
      bufferRects.push(...p.rects)
    }
  }

  if (bufferText.trim()) {
    chunks.push({
      text: bufferText.trim(),
      rects: bufferRects,
      paragraph_index: bufferStartPara,
    })
  }

  return chunks
}

/* ================= SEMANTIC CONTINUITY ================= */

function isSemanticallyContinuous(a: string, b: string) {
  const prev = a.trim()
  const next = b.trim()
  if (!prev || !next) return true

  if (sentenceTokenizer) {
    try {
      const sents = sentenceTokenizer.tokenize(prev)
      const last = sents[sents.length - 1] || ""
      if (!/[.!?]$/.test(last)) return true
    } catch {}
  } else {
    if (!/[.!?]$/.test(prev)) return true
  }

  if (/^[a-z]/.test(next)) return true

  if (
    /^(and|or|but|which|that|because|however|therefore|thus|whereas)\b/i.test(
      next
    )
  ) return true

  if (/^\(?[a-zivx]+\)/i.test(next) || /^\d+(\.\d+)*\s/.test(next))
    return true

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

  if (overlap / Math.max(1, Math.min(A.size, B.size)) > 0.2) return true

  try {
    const na = nlp(prev).nouns().out("array") as string[]
    const nb = nlp(next).nouns().out("array") as string[]

    const set = new Set(na.map(n => n.toLowerCase()))
    for (const n of nb) {
      if (set.has(n.toLowerCase())) return true
    }
  } catch {}

  return false
}
