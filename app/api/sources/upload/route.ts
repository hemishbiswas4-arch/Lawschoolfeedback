// =======================================================
// FILE: app/api/sources/upload/route.ts
// =======================================================

export const runtime = "nodejs"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import * as pdfjs from "pdfjs-dist/legacy/build/pdf"
import crypto from "crypto"
import nlp from "compromise"
import natural from "natural"

// REQUIRED FOR NODE PDFJS
;(pdfjs as any).GlobalWorkerOptions.workerSrc =
  require("pdfjs-dist/legacy/build/pdf.worker.js")

/* ================= NLP SETUP ================= */
/**
 * natural typings are broken.
 * Runtime constructor is correct.
 * We explicitly bypass types.
 */
const SentenceTokenizer =
  (natural as any).SentenceTokenizer ?? (natural as any).sentenceTokenizer

const sentenceTokenizer = SentenceTokenizer ? new SentenceTokenizer() : null

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/* ================= ROUTE ================= */

export async function POST(req: NextRequest) {
  console.log("UPLOAD ▶ request received")

  try {
    const form = await req.formData()

    const file = form.get("file") as File | null
    const projectId = form.get("project_id") as string | null
    const type = form.get("type") as string | null
    const title = form.get("title") as string | null
    const userId = form.get("user_id") as string | null

    if (!file || !projectId || !type || !title || !userId) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF allowed" }, { status: 400 })
    }

    const sourceId = crypto.randomUUID()
    const path = `${projectId}/${sourceId}.pdf`

    const { error: storageError } = await supabaseAdmin.storage
      .from("sources")
      .upload(path, file, { contentType: "application/pdf" })

    if (storageError) {
      return NextResponse.json(
        { error: storageError.message },
        { status: 500 }
      )
    }

    const { data: source, error: sourceError } = await supabaseAdmin
      .from("project_sources")
      .insert({
        id: sourceId,
        project_id: projectId,
        type,
        title,
        uploaded_by: userId,
        storage_path: path,
      })
      .select()
      .single()

    if (sourceError || !source) {
      return NextResponse.json(
        { error: sourceError?.message ?? "Source insert failed" },
        { status: 500 }
      )
    }

    const { data: fileData, error: downloadError } =
      await supabaseAdmin.storage.from("sources").download(path)

    if (downloadError || !fileData) {
      return NextResponse.json(
        { error: "Failed to download PDF from storage" },
        { status: 500 }
      )
    }

    /* ================= PARSE PDF ================= */

    const buffer = await fileData.arrayBuffer()

    const pdf = await pdfjs
      .getDocument({
        data: buffer,
        disableWorker: true,
      })
      .promise

    let globalChunkIndex = 0

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum)
      const viewport = page.getViewport({ scale: 1 })
      const pageWidth = viewport.width
      const pageHeight = viewport.height

      const textContent = await page.getTextContent()

      const paragraphs = normalizeParagraphs(
        textContent.items as any[],
        pageWidth,
        pageHeight
      )

      const chunks = contextualChunkParagraphs(paragraphs)

      let charCursor = 0

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        const text = chunk.text.trim()
        if (!text) continue

        const charStart = charCursor
        const charEnd = charCursor + text.length
        charCursor = charEnd

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
          checksum: crypto.createHash("sha256").update(text).digest("hex"),
        })
      }
    }

    console.log("UPLOAD ✓ complete")

    return NextResponse.json({ ok: true, sourceId: source.id })
  } catch (err: any) {
    console.error("UPLOAD ✗", err)
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    )
  }
}

/* ================= PARAGRAPH NORMALIZATION ================= */

type Rect = {
  left: number
  top: number
  width: number
  height: number
}

type Paragraph = {
  text: string
  rects: Rect[]
}

function normalizeParagraphs(
  items: any[],
  pageWidth: number,
  pageHeight: number
): Paragraph[] {
  const paras: Paragraph[] = []
  let current: Paragraph = { text: "", rects: [] }

  for (const item of items) {
    const str = item.str as string
    const [x, y] = item.transform.slice(4, 6) as [number, number]

    if (!str.trim()) {
      if (current.text.trim()) {
        paras.push(current)
        current = { text: "", rects: [] }
      }
      continue
    }

    const w = item.width as number
    const h = item.height as number

    current.rects.push({
      left: x / pageWidth,
      width: w / pageWidth,
      top: 1 - (y + h) / pageHeight,
      height: h / pageHeight,
    })

    current.text += str + " "
  }

  if (current.text.trim()) paras.push(current)

  return paras
}

/* ================= CONTEXTUAL CHUNKING ================= */

type Chunk = {
  text: string
  rects: Rect[]
  paragraph_index: number
}

function contextualChunkParagraphs(paragraphs: Paragraph[]): Chunk[] {
  const MAX_CHARS = 900
  const MIN_CHARS = 250

  const chunks: Chunk[] = []

  let bufferText = ""
  let bufferRects: Rect[] = []
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

function isSemanticallyContinuous(a: string, b: string): boolean {
  const prev = a.trim()
  const next = b.trim()

  if (!prev || !next) return true

  /* ---------- 1️⃣ Sentence boundary (natural) ---------- */
  if (sentenceTokenizer) {
    try {
      const sents = sentenceTokenizer.tokenize(prev)
      const last = sents[sents.length - 1] || ""
      if (!/[.!?]$/.test(last)) return true
    } catch {
      /* ignore */
    }
  } else {
    if (!/[.!?]$/.test(prev)) return true
  }

  /* ---------- 2️⃣ Discourse continuation ---------- */
  if (/^[a-z]/.test(next)) return true
  if (
    /^(and|or|but|which|that|because|however|therefore|thus|whereas)\b/i.test(
      next
    )
  )
    return true
  if (/^\(?[a-zivx]+\)/i.test(next) || /^\d+(\.\d+)*\s/.test(next))
    return true

  /* ---------- 3️⃣ Lexical overlap ---------- */
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2)
    )

  const A = tokenize(prev)
  const B = tokenize(next)

  let overlap = 0
  for (const t of A) if (B.has(t)) overlap++

  const ratio = overlap / Math.max(1, Math.min(A.size, B.size))
  if (ratio > 0.2) return true

  /* ---------- 4️⃣ Shallow semantic overlap (compromise) ---------- */
  try {
    const na = nlp(prev).nouns().out("array") as string[]
    const nb = nlp(next).nouns().out("array") as string[]
    const set = new Set(na.map((n) => n.toLowerCase()))
    for (const n of nb) if (set.has(n.toLowerCase())) return true
  } catch {
    /* ignore */
  }

  return false
}
