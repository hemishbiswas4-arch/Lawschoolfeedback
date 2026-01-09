// =======================================================
// FILE: app/api/reverse-engineer/analyze/route.ts
// PURPOSE: Standalone reverse engineering pipeline
//          - Processes sources and project text in one shot
//          - No database dependencies
//          - Completely separate from projects pipeline
// =======================================================

export const runtime = "nodejs"

import { NextRequest, NextResponse } from "next/server"
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime"
import * as pdfjs from "pdfjs-dist/legacy/build/pdf"
import crypto from "crypto"
import natural from "natural"

/* 🔴 REQUIRED FOR NODE PDFJS */
;(pdfjs as any).GlobalWorkerOptions.workerSrc =
  require("pdfjs-dist/legacy/build/pdf.worker.js")

/* ================= CLIENTS ================= */

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "us-east-1",
})

const EMBED_MODEL_ID = "cohere.embed-english-v3"
const GENERATION_INFERENCE_PROFILE_ARN =
  process.env.BEDROCK_INFERENCE_PROFILE_ARN!

/* ================= TYPES ================= */

type SourceFile = {
  name: string
  type: string
  title: string
  buffer: ArrayBuffer
}

type SourceChunk = {
  id: string
  source_id: string
  source_title: string
  source_type: string
  text: string
  page_number: number
  paragraph_index: number
  chunk_index: number
  embedding: number[]
}

type ClaimWithFootnote = {
  claim_text: string
  footnote_number: number
  footnote_text: string
  char_start: number
  char_end: number
  page_number: number
}

type ProjectChunk = {
  chunk_index: number
  text: string
  char_start: number
  char_end: number
  page_number?: number
  claims_with_footnotes?: ClaimWithFootnote[] // Claims with their footnotes
}

type CitationMatch = {
  citation_text: string
  source_chunk_id: string
  source_id: string
  source_title: string
  source_type: string
  source_chunk_text: string
  source_page_number: number
  match_confidence: number
  match_type: "citation" | "semantic"
}

type SourceChunkMatch = {
  chunk_id: string
  source_id: string
  source_title: string
  source_type: string
  text: string
  page_number: number
  paragraph_index: number
  similarity: number
}

type ClaimVerification = {
  claim_text: string
  footnote_number: number
  footnote_text: string
  source_id: string
  source_title: string
  source_type: string
  supporting_chunks: Array<{
    chunk_id: string
    chunk_text: string
    page_number: number
    support_score: number
    reasoning?: string
  }>
  verification_score: number // How well the claim is normatively supported
  overall_assessment?: string // Claude's assessment of whether claim is supported
}

type ProjectChunkAnalysis = {
  chunk_index: number
  text: string
  char_start: number
  char_end: number
  page_number?: number
  claims_with_footnotes?: ClaimWithFootnote[]
  claim_verifications?: ClaimVerification[]
  matches: SourceChunkMatch[]
  avg_similarity: number
  max_similarity: number
  sources_represented: string[]
}

type AnalysisResult = {
  project_chunks: ProjectChunkAnalysis[]
  overall_stats: {
    total_chunks: number
    total_footnotes: number
    footnotes_matched: number
    claims_verified: number
    avg_verification_score: number
    avg_similarity_across_all: number
    sources_covered: number
    sources_covered_details: Array<{
      source_id: string
      source_title: string
      source_type: string
      match_count: number
      avg_similarity: number
      footnote_matches: number
    }>
    chunks_with_high_similarity: number
    chunks_with_medium_similarity: number
    chunks_with_low_similarity: number
    all_footnotes?: Array<{
      footnote_number: number
      footnote_text: string
      page_number: number
      has_verification: boolean
      verification_score: number
      matched_source: string | null
      has_claim: boolean
    }>
  }
}

/* ================= UTILS ================= */

const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms))

async function embedTextBatch(texts: string[], runId: string): Promise<number[][]> {
  // Cohere supports batch embedding up to 96 texts
  const BATCH_SIZE = 96
  const results: number[][] = []
  
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map(t => t.slice(0, 2048))
    let attempt = 0
    
    while (true) {
      try {
        const embedRes = await bedrock.send(
          new InvokeModelCommand({
            modelId: EMBED_MODEL_ID,
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify({
              texts: batch,
              input_type: "search_document",
            }),
          })
        )

        const embedJson = JSON.parse(
          Buffer.from(embedRes.body!).toString("utf-8")
        )

        const embeddings = embedJson?.embeddings || []
        if (embeddings.length !== batch.length) {
          throw new Error(`Expected ${batch.length} embeddings, got ${embeddings.length}`)
        }

        results.push(...embeddings)
        break
      } catch (err: any) {
        if (err?.name === "ThrottlingException" && attempt < 3) {
          attempt++
          const wait = Math.min(1000 * attempt, 3000)
          log(runId, "EMBED_BATCH_THROTTLED", { attempt, wait }, "WARN")
          await sleep(wait)
          continue
        }
        throw err
      }
    }
  }
  
  return results
}

async function embedText(text: string, runId: string): Promise<number[]> {
  const results = await embedTextBatch([text], runId)
  return results[0]
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

function chunkProjectText(
  text: string,
  chunkSize: number = 3
): ProjectChunk[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0)

  const chunks: ProjectChunk[] = []
  let charCursor = 0

  for (let i = 0; i < paragraphs.length; i += chunkSize) {
    const paragraphGroup = paragraphs.slice(i, i + chunkSize)
    const chunkText = paragraphGroup.join("\n\n").trim()

    if (chunkText.length < 20) continue

    const charStart = charCursor
    const charEnd = charCursor + chunkText.length

    chunks.push({
      chunk_index: chunks.length,
      text: chunkText,
      char_start: charStart,
      char_end: charEnd,
    })

    charCursor = charEnd + 2
  }

  if (chunks.length === 0 && text.trim().length > 0) {
    chunks.push({
      chunk_index: 0,
      text: text.trim(),
      char_start: 0,
      char_end: text.trim().length,
    })
  }

  return chunks
}

function normalizeParagraphs(
  items: any[],
  viewportWidth: number,
  viewportHeight: number
): Array<{ text: string; paragraph_index: number }> {
  const paragraphs: Array<{ text: string; paragraph_index: number }> = []
  let currentPara = ""
  let currentParaIndex = 0

  for (const item of items) {
    if (item.str === undefined) continue

    const text = item.str.trim()
    if (!text) continue

    if (currentPara && text.match(/^[A-Z]/) && currentPara.endsWith(".")) {
      paragraphs.push({
        text: currentPara.trim(),
        paragraph_index: currentParaIndex++,
      })
      currentPara = text + " "
    } else {
      currentPara += text + " "
    }
  }

  if (currentPara.trim()) {
    paragraphs.push({
      text: currentPara.trim(),
      paragraph_index: currentParaIndex,
    })
  }

  return paragraphs
}

function contextualChunkParagraphs(
  paragraphs: Array<{ text: string; paragraph_index: number }>
): Array<{ text: string; paragraph_index: number }> {
  const chunks: Array<{ text: string; paragraph_index: number }> = []
  const CHUNK_SIZE = 3

  for (let i = 0; i < paragraphs.length; i += CHUNK_SIZE) {
    const group = paragraphs.slice(i, i + CHUNK_SIZE)
    const combinedText = group.map(p => p.text).join(" ").trim()

    if (combinedText.length < 20) continue

    chunks.push({
      text: combinedText,
      paragraph_index: group[0].paragraph_index,
    })
  }

  return chunks.length > 0 ? chunks : paragraphs
}

async function processPDF(
  buffer: ArrayBuffer,
  sourceId: string,
  sourceTitle: string,
  sourceType: string,
  runId: string
): Promise<SourceChunk[]> {
  const pdf = await (pdfjs as any).getDocument({
    data: buffer,
    disableWorker: true,
  }).promise

  // First pass: extract all chunks
  const chunkData: Array<{
    text: string
    page_number: number
    paragraph_index: number
    chunk_index: number
  }> = []
  let globalChunkIndex = 0

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale: 1 })
    const textContent = await page.getTextContent()

    const paragraphs = normalizeParagraphs(
      textContent.items,
      viewport.width,
      viewport.height
    )

    const contextualChunks = contextualChunkParagraphs(paragraphs)

    for (const chunk of contextualChunks) {
      const text = chunk.text.trim()
      if (!text || text.length < 10) continue

      chunkData.push({
        text,
        page_number: pageNum,
        paragraph_index: chunk.paragraph_index,
        chunk_index: globalChunkIndex++,
      })
    }
  }

  // Batch embed all chunks at once
  const texts = chunkData.map(c => c.text)
  log(runId, "BATCH_EMBEDDING", { chunk_count: texts.length })
  
  let embeddings: number[][]
  try {
    embeddings = await embedTextBatch(texts, runId)
  } catch (err: any) {
    log(runId, "BATCH_EMBED_FAILED", { error: err?.message }, "ERROR")
    return []
  }

  // Combine chunks with embeddings
  const chunks: SourceChunk[] = chunkData.map((chunk, idx) => ({
    id: crypto.randomUUID(),
    source_id: sourceId,
    source_title: sourceTitle,
    source_type: sourceType,
    text: chunk.text,
    page_number: chunk.page_number,
    paragraph_index: chunk.paragraph_index,
    chunk_index: chunk.chunk_index,
    embedding: embeddings[idx],
  }))

  return chunks
}

type Footnote = {
  number: number
  text: string
  page_number: number
  y_position: number
}

function extractFootnotesFromPage(
  textContent: any,
  viewport: any,
  pageNum: number
): Footnote[] {
  const footnotes: Footnote[] = []
  const items = textContent.items || []
  
  if (items.length === 0) {
    return footnotes
  }
  
  // STRATEGY 1: Extract ALL text from bottom 50% and parse it comprehensively
  const bottomThreshold = viewport.height * 0.5
  const bottomItems: Array<{ text: string; y: number; x: number; fontSize: number }> = []
  
  for (const item of items) {
    if (!item.str || !item.transform) continue
    const y = item.transform[5] || 0
    const x = item.transform[4] || 0
    const fontSize = item.height || 0
    
    if (y < bottomThreshold) {
      bottomItems.push({ text: item.str, y, x, fontSize })
    }
  }
  
  // Sort by Y (bottom to top) and X (left to right) to reconstruct lines
  bottomItems.sort((a, b) => {
    const yDiff = a.y - b.y
    if (Math.abs(yDiff) < 3) return a.x - b.x // Same line, sort by X
    return yDiff // Sort by Y (bottom to top)
  })
  
  // Group into lines (items with similar Y positions)
  const lines: Array<{ text: string; y: number; items: typeof bottomItems }> = []
  let currentLine: typeof bottomItems = []
  let currentY = -1
  
  for (const item of bottomItems) {
    if (currentY === -1 || Math.abs(item.y - currentY) < 3) {
      // Same line
      currentLine.push(item)
      if (currentY === -1) currentY = item.y
    } else {
      // New line
      if (currentLine.length > 0) {
        currentLine.sort((a, b) => a.x - b.x)
        lines.push({
          text: currentLine.map(i => i.text).join(' '),
          y: currentY,
          items: currentLine
        })
      }
      currentLine = [item]
      currentY = item.y
    }
  }
  // Don't forget the last line
  if (currentLine.length > 0) {
    currentLine.sort((a, b) => a.x - b.x)
    lines.push({
      text: currentLine.map(i => i.text).join(' '),
      y: currentY,
      items: currentLine
    })
  }
  
  // Now parse lines for footnotes - be very permissive
  const foundFootnotes = new Map<number, { text: string; y: number }>()
  
  for (const line of lines) {
    const lineText = line.text.trim()
    if (!lineText || lineText.length < 3) continue
    
    // Try multiple patterns to find footnote numbers
    // Pattern 1: Number at start followed by punctuation and text
    let match = lineText.match(/^(\d{1,3})[\.\)]\s*(.+)/)
    if (!match) {
      // Pattern 2: Number in brackets at start
      match = lineText.match(/^\[(\d{1,3})\]\s*(.+)/)
    }
    if (!match) {
      // Pattern 3: Number at start followed by space and text (more permissive)
      match = lineText.match(/^(\d{1,3})\s+([A-Za-z].+)/)
    }
    if (!match) {
      // Pattern 4: Number at start followed by any text
      match = lineText.match(/^(\d{1,3})\s*(.+)/)
    }
    if (!match) {
      // Pattern 5: Number anywhere in line (for non-standard formats)
      match = lineText.match(/(?:^|\s)(\d{1,3})[\.\)]\s*(.+)/)
    }
    
    if (match) {
      const footnoteNum = parseInt(match[1])
      const footnoteText = (match[2] || '').trim()
      
      if (footnoteNum > 0 && footnoteNum < 1000 && footnoteText.length > 3) {
        // Check if we already have this footnote (keep the one with more text)
        if (!foundFootnotes.has(footnoteNum) || 
            foundFootnotes.get(footnoteNum)!.text.length < footnoteText.length) {
          foundFootnotes.set(footnoteNum, { text: footnoteText, y: line.y })
        }
      }
    }
  }
  
  // Handle multi-line footnotes - if a line doesn't start with a number, it might be continuation
  const sortedLines = [...lines].sort((a, b) => b.y - a.y) // Bottom to top
  const processedFootnotes = new Map<number, { text: string; y: number }>()
  
  for (let i = 0; i < sortedLines.length; i++) {
    const line = sortedLines[i]
    const lineText = line.text.trim()
    
    // Check if this line starts a footnote
    let match = lineText.match(/^(\d{1,3})[\.\)]\s*(.+)/) ||
                lineText.match(/^\[(\d{1,3})\]\s*(.+)/) ||
                lineText.match(/^(\d{1,3})\s+([A-Za-z].+)/) ||
                lineText.match(/^(\d{1,3})\s*(.+)/)
    
    if (match) {
      const footnoteNum = parseInt(match[1])
      let footnoteText = (match[2] || '').trim()
      
      // Look ahead for continuation lines
      for (let j = i + 1; j < sortedLines.length; j++) {
        const nextLine = sortedLines[j]
        const nextText = nextLine.text.trim()
        
        // If next line doesn't start with a number, it's likely a continuation
        if (!nextText.match(/^\d+[\.\)\]]/) && 
            !nextText.match(/^\[\d+\]/) &&
            Math.abs(nextLine.y - line.y) < 20) { // Close Y position
          footnoteText += ' ' + nextText
          i = j // Skip this line in outer loop
        } else {
          break
        }
      }
      
      if (footnoteNum > 0 && footnoteNum < 1000 && footnoteText.length > 3) {
        if (!processedFootnotes.has(footnoteNum) || 
            processedFootnotes.get(footnoteNum)!.text.length < footnoteText.length) {
          processedFootnotes.set(footnoteNum, { text: footnoteText, y: line.y })
        }
      }
    }
  }
  
  // Use processed footnotes (with continuations) if we found any, otherwise use found footnotes
  const finalFootnotes = processedFootnotes.size > 0 ? processedFootnotes : foundFootnotes
  
  // Convert to Footnote array
  for (const [num, data] of finalFootnotes.entries()) {
    footnotes.push({
      number: num,
      text: data.text,
      page_number: pageNum,
      y_position: data.y,
    })
  }
  
  // If we still found very few footnotes, try even more aggressive approach
  // Also try if we found some but might be missing more
  if (bottomItems.length > 10) {
    // Try extracting ALL numbers from bottom area and see if they match footnote patterns
    const allBottomText = bottomItems.map(i => i.text).join(' ')
    
    // Find all number sequences that could be footnotes
    const numberMatches = Array.from(allBottomText.matchAll(/\b(\d{1,3})\b/g))
    const potentialNumbers = new Set<number>()
    
    for (const match of numberMatches) {
      const num = parseInt(match[1])
      if (num > 0 && num < 1000) {
        potentialNumbers.add(num)
      }
    }
    
    // For each potential number, try to find its text
    for (const num of potentialNumbers) {
      if (footnotes.find(f => f.number === num)) continue // Already found
      
      // Look for this number followed by text - try multiple patterns
      const patterns = [
        new RegExp(`\\b${num}[\.\\)]\\s+([^\\d]{10,}?)(?=\\s+\\d+[\.\\)]|\\s+\\[\\d+\\]|$)`, 'i'),
        new RegExp(`\\[${num}\\]\\s+([^\\d]{10,}?)(?=\\s+\\d+[\.\\)]|\\s+\\[\\d+\\]|$)`, 'i'),
        new RegExp(`\\b${num}\\s+([A-Za-z][^\\d]{10,}?)(?=\\s+\\d+[\.\\)]|\\s+\\[\\d+\\]|$)`, 'i'),
        // More permissive: number followed by any substantial text
        new RegExp(`\\b${num}\\s+([^\\d]{15,}?)(?=\\s+\\d+[\.\\)]|\\s+\\[\\d+\\]|\\s*$)`, 'i'),
      ]
      
      for (const pattern of patterns) {
        const match = allBottomText.match(pattern)
        if (match && match[1]) {
          const text = match[1].trim()
          // Stop at next number or end of reasonable length
          const nextNumMatch = text.match(/\s+(\d{1,3})[\.\)\]\s]/)
          const finalText = nextNumMatch 
            ? text.slice(0, text.indexOf(nextNumMatch[0])).trim()
            : text.slice(0, 500).trim()
          
          if (finalText.length > 10) {
            footnotes.push({
              number: num,
              text: finalText,
              page_number: pageNum,
              y_position: 0,
            })
            break
          }
        }
      }
    }
  }
  
  // Remove duplicates and sort
  const uniqueFootnotes = new Map<number, Footnote>()
  for (const fn of footnotes) {
    if (!uniqueFootnotes.has(fn.number) || 
        uniqueFootnotes.get(fn.number)!.text.length < fn.text.length) {
      uniqueFootnotes.set(fn.number, fn)
    }
  }
  
  return Array.from(uniqueFootnotes.values()).sort((a, b) => a.number - b.number)
}

function extractClaimsWithFootnotes(
  text: string,
  footnotes: Map<number, Footnote>,
  charOffset: number,
  pageNum: number,
  superscriptMap?: Map<number, { x: number; y: number; nearbyText: string }>
): ClaimWithFootnote[] {
  const claims: ClaimWithFootnote[] = []
  
  // Find footnote references in text: [1], (1), superscript numbers, etc.
  // Academic papers commonly use:
  // - [1] or [1, 2] for multiple citations
  // - (1) for parenthetical citations  
  // - Superscript numbers (often smaller font, positioned above baseline)
  // - Numbers after words or punctuation
  const patterns = [
    /\[(\d+)\]/g,                                    // [1] or [1, 2, 3]
    /\((\d+)\)/g,                                    // (1)
    /\s(\d+)[\.\)]\s/g,                              // " 1. " or " 1) " (less common in academic)
    // Superscript detection: number immediately after word/punctuation (common in academic papers)
    /([A-Za-z][A-Za-z\s]{2,}|[\.\,\;\:\)])\s*(\d{1,3})(?![0-9\.,\)\]])/g,  // Word/punct followed by superscript number
    // Standalone numbers that might be superscripts (between word boundaries)
    /\b(\d{1,3})\b(?=\s+[A-Za-z])/g,                // Number followed by space and letter
  ]
  
  // Also check for numbers that exist in superscript map (detected via PDF structure)
  if (superscriptMap && superscriptMap.size > 0) {
    for (const [footnoteNum, supInfo] of superscriptMap.entries()) {
      // Try to find this number in the text, possibly as a superscript
      // Look for the number near the nearby text context
      const contextWords = supInfo.nearbyText.split(/\s+/).filter(w => w.length > 3).slice(0, 5)
      if (contextWords.length > 0) {
        // Try to find a pattern that matches the context
        const contextPattern = new RegExp(
          contextWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*?'),
          'i'
        )
        const contextMatch = text.match(contextPattern)
        if (contextMatch) {
          // Found context, now look for the footnote number nearby
          const contextIndex = contextMatch.index || 0
          const searchStart = Math.max(0, contextIndex - 50)
          const searchEnd = Math.min(text.length, contextIndex + contextMatch[0].length + 50)
          const searchArea = text.slice(searchStart, searchEnd)
          
          // Look for the footnote number in various formats
          const numPatterns = [
            new RegExp(`\\[${footnoteNum}\\]`, 'g'),
            new RegExp(`\\(${footnoteNum}\\)`, 'g'),
            new RegExp(`\\b${footnoteNum}\\b`, 'g'),
          ]
          
          for (const pattern of numPatterns) {
            const match = pattern.exec(searchArea)
            if (match) {
              // Found a match, add it to patterns to process
              patterns.push(pattern)
              break
            }
          }
        }
      }
    }
  }
  
  const foundNumbers = new Map<number, number>() // Map footnote number to position
  
  for (let patternIdx = 0; patternIdx < patterns.length; patternIdx++) {
    const pattern = patterns[patternIdx]
    let match
    const regex = new RegExp(pattern.source, pattern.flags)
    
    while ((match = regex.exec(text)) !== null) {
      // Extract number based on pattern type
      // Patterns 0-2: number is in group 1
      // Pattern 3: number is in group 2 (after word/punctuation)
      // Pattern 4: number is in group 1 (standalone)
      const numberStr = patternIdx === 3 ? match[2] : match[1]
      const number = parseInt(numberStr)
      
      // Validate: number should exist in footnotes and be reasonable
      // Also check context to avoid false positives (dates, page numbers, etc.)
      if (number > 0 && number < 1000 && footnotes.has(number)) {
        // Calculate reference position in text
        let refPosition = match.index
        if (patternIdx === 3) {
          // For superscript pattern, position is after the preceding word/punctuation
          refPosition += match[1].length
        }
        
        // Additional validation: check if this looks like a real footnote reference
        // Avoid matching numbers that are clearly part of dates, page numbers, etc.
        const beforeMatch = text.slice(Math.max(0, refPosition - 10), refPosition)
        const afterMatch = text.slice(refPosition + numberStr.length, refPosition + numberStr.length + 10)
        
        // Skip if it looks like part of a date (e.g., "2023", "page 1", "section 2.3")
        if (/\d{4}/.test(beforeMatch + numberStr + afterMatch) || 
            /page\s*\d+/i.test(beforeMatch + numberStr + afterMatch) ||
            /section\s*\d+/i.test(beforeMatch + numberStr + afterMatch)) {
          continue
        }
        
        // Only add if we haven't seen this footnote number, or if this position is better
        if (!foundNumbers.has(number) || Math.abs(foundNumbers.get(number)! - refPosition) > 50) {
          foundNumbers.set(number, refPosition)
          
          const footnote = footnotes.get(number)!
          
          // Extract claim text: try to get full sentence(s) containing the footnote
          const refPositionInText = refPosition
          
          // Find sentence start: look backwards for sentence boundary
          let sentenceStart = refPositionInText
          for (let i = refPositionInText - 1; i >= Math.max(0, refPositionInText - 300); i--) {
            if (text[i] === '.' && (i === 0 || text[i - 1] !== '.')) {
              // Check if it's end of sentence (followed by space and capital, or end of text)
              if (i === text.length - 1 || (text[i + 1] === ' ' && /[A-Z]/.test(text[i + 2]))) {
                sentenceStart = i + 1
                break
              }
            }
          }
          // If no sentence start found, go back up to 200 chars
          if (sentenceStart === refPositionInText) {
            sentenceStart = Math.max(0, refPositionInText - 200)
          }
          
          // Find sentence end: look forwards for sentence boundary
          let sentenceEnd = refPositionInText + match[0].length
          for (let i = sentenceEnd; i < Math.min(text.length, sentenceEnd + 300); i++) {
            if (text[i] === '.' && (i === text.length - 1 || text[i + 1] === ' ')) {
              sentenceEnd = i + 1
              break
            }
          }
          // If no sentence end found, extend up to 200 chars
          if (sentenceEnd === refPositionInText + match[0].length) {
            sentenceEnd = Math.min(text.length, sentenceEnd + 200)
          }
          
          const claimText = text.slice(sentenceStart, sentenceEnd).trim()
          
          // Clean up: remove extra whitespace, ensure it's a meaningful claim
          const cleanClaim = claimText.replace(/\s+/g, ' ').trim()
          
          if (cleanClaim.length > 20 && cleanClaim.length < 2000) {
            claims.push({
              claim_text: cleanClaim,
              footnote_number: number,
              footnote_text: footnote.text,
              char_start: charOffset + sentenceStart,
              char_end: charOffset + sentenceEnd,
              page_number: pageNum,
            })
          }
        }
      }
    }
  }
  
  // Sort by position in text to maintain order
  claims.sort((a, b) => a.char_start - b.char_start)
  
  return claims
}

async function normalizeCitationsBatch(
  citations: string[],
  sourceTitles: Array<{ id: string; title: string; type: string }>,
  runId: string
): Promise<Map<string, { source_id: string; confidence: number; normalized_title: string }>> {
  if (citations.length === 0 || sourceTitles.length === 0) {
    return new Map()
  }
  
  const prompt = `You are normalizing citations from a research paper to match them to actual source documents.

CITATIONS FROM PAPER (may be in CSM/Chicago Manual of Style format):
${citations.map((c, idx) => `[${idx}] "${c}"`).join("\n")}

AVAILABLE SOURCE DOCUMENTS:
${sourceTitles.map((s, idx) => `[${idx}] ${s.title} (${s.type})`).join("\n")}

TASK:
For each citation, parse the citation format (CSM, legal citation, academic citation, etc.), extract key identifying information (author names, document title/keywords, publication details), and match it to ONE of the available source documents.

Return ONLY valid JSON in this exact format:
{
  "matches": [
    {
      "citation_idx": 0,
      "source_idx": 1,
      "confidence": 0.9,
      "normalized_title": "The actual source document title",
      "reasoning": "Brief explanation"
    }
  ]
}

Only include matches with confidence >= 0.6. Each citation should match to at most ONE source.`

  try {
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
          max_tokens: 3000,
          temperature: 0.1,
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
      log(runId, "CITATION_BATCH_NORMALIZE_NO_JSON")
      return new Map()
    }

    const result = JSON.parse(jsonSlice)
    const matches = new Map<string, { source_id: string; confidence: number; normalized_title: string }>()
    
    for (const match of result.matches || []) {
      if (match.citation_idx >= 0 && match.citation_idx < citations.length &&
          match.source_idx >= 0 && match.source_idx < sourceTitles.length &&
          match.confidence >= 0.6) {
        const citation = citations[match.citation_idx]
        const source = sourceTitles[match.source_idx]
        matches.set(citation, {
          source_id: source.id,
          confidence: match.confidence,
          normalized_title: match.normalized_title || source.title,
        })
      }
    }
    
    return matches
  } catch (err: any) {
    log(runId, "CITATION_BATCH_NORMALIZE_ERROR", { error: err?.message }, "ERROR")
    return new Map()
  }
}

async function verifyClaimAgainstSource(
  claim: ClaimWithFootnote,
  normalizedSource: { source_id: string; source_title: string; source_type: string; confidence: number },
  sourceChunks: SourceChunk[],
  runId: string
): Promise<ClaimVerification> {
  // Filter to chunks from the matched source
  const matchedChunks = sourceChunks.filter(c => c.source_id === normalizedSource.source_id)
  
  if (matchedChunks.length === 0) {
    return {
      claim_text: claim.claim_text,
      footnote_number: claim.footnote_number,
      footnote_text: claim.footnote_text,
      source_id: normalizedSource.source_id,
      source_title: normalizedSource.source_title,
      source_type: normalizedSource.source_type,
      supporting_chunks: [],
      verification_score: 0,
    }
  }
  
  // Use Claude to verify the claim normatively (not just text similarity)
  const chunksSummary = matchedChunks.slice(0, 40).map((chunk, idx) => ({
    idx,
    id: chunk.id,
    page: chunk.page_number,
    text: chunk.text.slice(0, 600), // More context for normative analysis
  }))
  
  const prompt = `You are a legal/academic expert verifying a normative claim from a research paper against its cited source. Your task is to assess whether the claim is ACTUALLY supported by the source, not just whether similar words appear.

CLAIM FROM PAPER:
"${claim.claim_text}"

FOOTNOTE CITATION:
"${claim.footnote_text}"

SOURCE DOCUMENT: ${normalizedSource.source_title} (${normalizedSource.source_type})

AVAILABLE CHUNKS FROM THIS SOURCE:
${chunksSummary.map(c => `[${c.idx}] Page ${c.page}\n${c.text}...`).join("\n\n")}

CRITICAL ANALYSIS TASK:
Analyze whether the claim is NORMATIVELY supported by the source. This means:

1. NORMATIVE CONTENT ANALYSIS:
   - Does the source actually make the same normative claim or argument?
   - Does the source support the legal/theoretical position stated in the claim?
   - Is the claim's interpretation of the source accurate?
   - Does the source provide evidence for the claim's conclusion?

2. ACCURACY VERIFICATION:
   - Is the claim factually accurate based on the source?
   - Does the claim misrepresent or oversimplify what the source says?
   - Are there contradictions between the claim and the source?

3. SUPPORT ASSESSMENT:
   - Which chunks actually support the claim's normative position?
   - How strongly does each chunk support the claim (0.0 = no support/contradicts, 1.0 = strongly supports)?
   - Does the chunk provide the evidence/authority the claim suggests?

4. REASONING:
   - Explain WHY each chunk supports or doesn't support the claim
   - Identify any gaps between what the claim says and what the source actually states
   - Note if the claim goes beyond what the source supports

Return ONLY valid JSON in this exact format:
{
  "verification_score": 0.75,
  "supporting_chunks": [
    {
      "chunk_idx": 0,
      "support_score": 0.85,
      "reasoning": "This chunk supports the claim because it states [specific normative content] which aligns with the claim's position that [specific aspect]. However, it does not fully address [specific limitation]."
    }
  ],
  "overall_assessment": "Brief summary of whether the claim is supported, contradicted, or partially supported"
}

verification_score: Overall score (0.0-1.0) for how well the claim is normatively supported
  - 0.9-1.0: Strongly supported, claim accurately reflects source
  - 0.7-0.9: Well supported with minor gaps
  - 0.5-0.7: Partially supported but claim may overstate or mischaracterize
  - 0.3-0.5: Weakly supported, significant gaps or mischaracterizations
  - 0.0-0.3: Not supported or contradicted

Only include chunks with support_score >= 0.5. Be strict - text similarity alone is NOT sufficient.`

  try {
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
          max_tokens: 3000,
          temperature: 0.1,
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
      log(runId, "CLAIM_VERIFY_NO_JSON", { claim: claim.claim_text.slice(0, 50) })
      return {
        claim_text: claim.claim_text,
        footnote_number: claim.footnote_number,
        footnote_text: claim.footnote_text,
        source_id: normalizedSource.source_id,
        source_title: normalizedSource.source_title,
        source_type: normalizedSource.source_type,
        supporting_chunks: [],
        verification_score: 0,
      }
    }

    const result = JSON.parse(jsonSlice)
    
    const supportingChunks = []
    for (const match of result.supporting_chunks || []) {
      if (match.chunk_idx >= 0 && match.chunk_idx < chunksSummary.length && match.support_score >= 0.5) {
        const chunkSummary = chunksSummary[match.chunk_idx]
        const fullChunk = matchedChunks.find(c => c.id === chunkSummary.id)
        
        if (fullChunk) {
          supportingChunks.push({
            chunk_id: fullChunk.id,
            chunk_text: fullChunk.text,
            page_number: fullChunk.page_number,
            support_score: match.support_score,
            reasoning: match.reasoning || result.overall_assessment || "Chunk supports the claim",
          })
        }
      }
    }
    
    // Use the verification score from Claude's normative analysis
    const verificationScore = result.verification_score || 0
    
    log(runId, "CLAIM_VERIFIED", {
      claim_preview: claim.claim_text.slice(0, 50),
      footnote: claim.footnote_number,
      source: normalizedSource.source_title,
      verification_score: verificationScore,
      supporting_chunks: supportingChunks.length,
      assessment: result.overall_assessment,
    })
    
    return {
      claim_text: claim.claim_text,
      footnote_number: claim.footnote_number,
      footnote_text: claim.footnote_text,
      source_id: normalizedSource.source_id,
      source_title: normalizedSource.source_title,
      source_type: normalizedSource.source_type,
      supporting_chunks: supportingChunks.sort((a, b) => b.support_score - a.support_score),
      verification_score: verificationScore,
      overall_assessment: result.overall_assessment,
    }
  } catch (err: any) {
    log(runId, "CLAIM_VERIFY_ERROR", { error: err?.message, claim: claim.claim_text.slice(0, 50) }, "ERROR")
    return {
      claim_text: claim.claim_text,
      footnote_number: claim.footnote_number,
      footnote_text: claim.footnote_text,
      source_id: normalizedSource.source_id,
      source_title: normalizedSource.source_title,
      source_type: normalizedSource.source_type,
      supporting_chunks: [],
      verification_score: 0,
    }
  }
}

function matchCitationToSourceChunksFallback(
  citationText: string,
  sourceChunks: SourceChunk[]
): CitationMatch[] {
  const matches: CitationMatch[] = []
  
  const normalizedCitation = citationText.toLowerCase().replace(/[^\w\s]/g, " ")
  const citationWords = normalizedCitation.split(/\s+/).filter(w => w.length > 3)
  
  if (citationWords.length === 0) return matches
  
  for (const sourceChunk of sourceChunks) {
    const normalizedChunk = sourceChunk.text.toLowerCase().replace(/[^\w\s]/g, " ")
    const chunkWords = normalizedChunk.split(/\s+/).filter(w => w.length > 3)
    
    let wordMatches = 0
    for (const citationWord of citationWords) {
      if (chunkWords.some(cw => cw.includes(citationWord) || citationWord.includes(cw))) {
        wordMatches++
      }
    }
    
    const wordScore = wordMatches / Math.max(citationWords.length, chunkWords.length)
    
    if (wordScore > 0.3) {
      matches.push({
        citation_text: citationText,
        source_chunk_id: sourceChunk.id,
        source_id: sourceChunk.source_id,
        source_title: sourceChunk.source_title,
        source_type: sourceChunk.source_type,
        source_chunk_text: sourceChunk.text,
        source_page_number: sourceChunk.page_number,
        match_confidence: wordScore,
        match_type: "citation",
      })
    }
  }
  
  matches.sort((a, b) => b.match_confidence - a.match_confidence)
  return matches.slice(0, 5)
}

async function processProjectPDF(
  buffer: ArrayBuffer,
  runId: string
): Promise<{ chunks: ProjectChunk[]; allFootnotes: Map<number, Footnote> }> {
  const pdf = await (pdfjs as any).getDocument({
    data: buffer,
    disableWorker: true,
  }).promise

  const chunks: ProjectChunk[] = []
  const allFootnotes = new Map<number, Footnote>() // Map footnote number to footnote
  let charCursor = 0

  // First pass: extract all footnotes from all pages
  let totalItemsProcessed = 0
  let itemsInFootnoteArea = 0
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale: 1 })
    const textContent = await page.getTextContent()
    
    totalItemsProcessed += textContent.items?.length || 0

    const footnotes = extractFootnotesFromPage(textContent, viewport, pageNum)
    for (const footnote of footnotes) {
      allFootnotes.set(footnote.number, footnote)
    }
    
    // Debug: count items in footnote area for first few pages
    if (pageNum <= 3) {
      const footnoteAreaThreshold = viewport.height * 0.5
      const itemsInArea = textContent.items?.filter((item: any) => {
        if (!item.str || !item.transform) return false
        const y = item.transform[5] || 0
        return y < footnoteAreaThreshold
      }).length || 0
      itemsInFootnoteArea += itemsInArea
      
      // Also extract sample text from bottom area for debugging
      const bottomTextSample = textContent.items
        ?.filter((item: any) => {
          if (!item.str || !item.transform) return false
          const y = item.transform[5] || 0
          return y < footnoteAreaThreshold
        })
        .slice(0, 20)
        .map((item: any) => item.str)
        .join(' ') || ''
      
      log(runId, "FOOTNOTE_EXTRACTION_DEBUG", {
        page: pageNum,
        total_items: textContent.items?.length || 0,
        items_in_footnote_area: itemsInArea,
        footnotes_found: footnotes.length,
        footnote_numbers: footnotes.map(f => f.number),
        bottom_text_sample: bottomTextSample.slice(0, 200)
      })
    }
  }

  log(runId, "FOOTNOTES_EXTRACTED", {
    total_footnotes: allFootnotes.size,
    footnote_numbers: Array.from(allFootnotes.keys()).sort((a, b) => a - b),
    total_pages: pdf.numPages,
    total_items_processed: totalItemsProcessed,
    items_in_footnote_area_sample: itemsInFootnoteArea,
  })

  // Second pass: extract main text and link to footnotes
  // Build a comprehensive text extraction that includes footnote markers
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale: 1 })
    const textContent = await page.getTextContent()

    // Extract main body text (exclude footnotes)
    // Calculate average font size to help identify superscript footnote markers
    const allFontSizes: number[] = []
    const allYPositions: number[] = []
    const textItems: Array<{ text: string; x: number; y: number; fontSize: number; transform: any }> = []
    
    for (const item of textContent.items) {
      if (item.str && item.transform) {
        const y = item.transform[5] || 0
        const x = item.transform[4] || 0
        const fontSize = item.height || 0
        
        allYPositions.push(y)
        if (fontSize) allFontSizes.push(fontSize)
        
        textItems.push({
          text: item.str,
          x,
          y,
          fontSize,
          transform: item.transform
        })
      }
    }
    
    const avgFontSize = allFontSizes.length > 0 
      ? allFontSizes.reduce((a, b) => a + b, 0) / allFontSizes.length 
      : 12
    const medianY = allYPositions.length > 0
      ? [...allYPositions].sort((a, b) => a - b)[Math.floor(allYPositions.length / 2)]
      : viewport.height * 0.5
    
    // Main body is typically above the median Y position (top half of page)
    // But we'll use a more conservative threshold to exclude footnotes
    const footnoteThreshold = Math.min(viewport.height * 0.3, medianY * 0.8)
    
    // Separate main text items from potential superscript markers
    const mainTextItems: any[] = []
    const potentialSuperscripts: Array<{ text: string; x: number; y: number; fontSize: number; nearbyText: string }> = []
    
    for (let i = 0; i < textItems.length; i++) {
      const item = textItems[i]
      const itemY = item.y
      
      // Check if it's in main body area
      if (itemY > footnoteThreshold) {
        // Check if this might be a superscript footnote marker
        // Superscripts are typically: smaller font, positioned slightly higher than baseline
        const isSmallFont = item.fontSize > 0 && item.fontSize < avgFontSize * 0.7
        const isNumber = /^\d+$/.test(item.text.trim())
        
        // Check Y position relative to nearby text (superscripts are higher)
        let isHigherThanNeighbors = false
        if (i > 0 && i < textItems.length - 1) {
          const prevY = textItems[i - 1].y
          const nextY = textItems[i + 1].y
          const avgNeighborY = (prevY + nextY) / 2
          // Superscript is typically 2-5px higher than baseline
          if (itemY > avgNeighborY + 2 && itemY < avgNeighborY + 8) {
            isHigherThanNeighbors = true
          }
        }
        
        if (isNumber && (isSmallFont || isHigherThanNeighbors)) {
          // This might be a superscript footnote marker
          // Get nearby text for context
          const nearbyText = []
          for (let j = Math.max(0, i - 5); j < Math.min(textItems.length, i + 5); j++) {
            if (j !== i && textItems[j].y > footnoteThreshold) {
              nearbyText.push(textItems[j].text)
            }
          }
          potentialSuperscripts.push({
            text: item.text.trim(),
            x: item.x,
            y: item.y,
            fontSize: item.fontSize,
            nearbyText: nearbyText.join(' ')
          })
        }
        
        mainTextItems.push({
          str: item.text,
          transform: item.transform,
          height: item.fontSize,
          hasEOL: false
        })
      }
    }
    
    // Log potential superscripts for debugging
    if (potentialSuperscripts.length > 0 && pageNum <= 3) {
      log(runId, "POTENTIAL_SUPERSCRIPT_MARKERS", {
        page: pageNum,
        count: potentialSuperscripts.length,
        markers: potentialSuperscripts.slice(0, 10).map(m => ({
          number: m.text,
          nearby_text: m.nearbyText.slice(0, 50),
          font_size: m.fontSize,
          avg_font_size: avgFontSize
        }))
      })
    }

    const paragraphs = normalizeParagraphs(
      mainTextItems,
      viewport.width,
      viewport.height
    )

    const contextualChunks = contextualChunkParagraphs(paragraphs)

    // Also create a map of potential superscript markers for this page
    const superscriptMap = new Map<number, { x: number; y: number; nearbyText: string }>()
    for (const sup of potentialSuperscripts) {
      const num = parseInt(sup.text)
      if (num > 0 && num < 1000 && allFootnotes.has(num)) {
        superscriptMap.set(num, { x: sup.x, y: sup.y, nearbyText: sup.nearbyText })
      }
    }

    for (const chunk of contextualChunks) {
      const text = chunk.text.trim()
      if (!text || text.length < 20) continue

      const charStart = charCursor
      const charEnd = charCursor + text.length

      // Extract claims with footnotes from this chunk
      // Pass superscript map to help with detection
      const claimsWithFootnotes = extractClaimsWithFootnotes(
        text, 
        allFootnotes, 
        charStart, 
        pageNum,
        superscriptMap
      )

      chunks.push({
        chunk_index: chunks.length,
        text,
        char_start: charStart,
        char_end: charEnd,
        page_number: pageNum,
        claims_with_footnotes: claimsWithFootnotes.length > 0 ? claimsWithFootnotes : undefined,
      })

      charCursor = charEnd + 2
    }
  }

  return { chunks, allFootnotes }
}

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

function log(runId: string, stage: string, data?: any, level: "INFO" | "WARN" | "ERROR" = "INFO") {
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

/* ================= HANDLER ================= */

export async function POST(req: NextRequest) {
  const runId = crypto.randomUUID().slice(0, 8)
  log(runId, "REQUEST_START")

  try {
    const formData = await req.formData()
    const projectText = formData.get("project_text") as string | null
    const projectPdf = formData.get("project_pdf") as File | null
    const sourcesJson = formData.get("sources") as string

    if ((!projectText?.trim() && !projectPdf) || !sourcesJson) {
      return NextResponse.json(
        { error: "Missing project_text or project_pdf, and sources" },
        { status: 400 }
      )
    }

    const sources: Array<{
      name: string
      type: string
      title: string
      buffer: string // base64 encoded
    }> = JSON.parse(sourcesJson)

    if (sources.length === 0) {
      return NextResponse.json(
        { error: "No sources provided" },
        { status: 400 }
      )
    }

    log(runId, "PROCESSING_SOURCES", { count: sources.length })

    /* ================= PROCESS ALL SOURCES (PARALLEL) ================= */

    const sourceProcessingPromises = sources.map(async (source) => {
      const sourceId = crypto.randomUUID()
      // Decode base64 to ArrayBuffer
      const base64Buffer = Buffer.from(source.buffer, "base64")
      const buffer = new Uint8Array(base64Buffer).buffer

      log(runId, "PROCESSING_SOURCE", {
        source_id: sourceId,
        name: source.name,
        type: source.type,
      })

      try {
        const chunks = await processPDF(
          buffer,
          sourceId,
          source.title,
          source.type,
          runId
        )
        log(runId, "SOURCE_PROCESSED", {
          source_id: sourceId,
          chunks: chunks.length,
        })
        return chunks
      } catch (err: any) {
        log(runId, "SOURCE_ERROR", {
          source_id: sourceId,
          error: err?.message,
        }, "ERROR")
        return []
      }
    })

    // Process all sources in parallel
    const sourceChunksArrays = await Promise.all(sourceProcessingPromises)
    const allSourceChunks: SourceChunk[] = sourceChunksArrays.flat()

    if (allSourceChunks.length === 0) {
      return NextResponse.json(
        { error: "No chunks extracted from sources" },
        { status: 500 }
      )
    }

    log(runId, "SOURCES_PROCESSED", {
      total_chunks: allSourceChunks.length,
      sources: sources.length,
    })

    /* ================= PROCESS PROJECT (PDF OR TEXT) ================= */

    let projectChunks: ProjectChunk[] = []

    let allFootnotes: Map<number, Footnote> = new Map()
    
    if (projectPdf) {
      // Process PDF project
      const pdfArrayBuffer = await projectPdf.arrayBuffer()
      const result = await processProjectPDF(pdfArrayBuffer, runId)
      projectChunks = result.chunks
      allFootnotes = result.allFootnotes
      log(runId, "PROJECT_PDF_PROCESSED", {
        total_chunks: projectChunks.length,
        total_footnotes: allFootnotes.size,
        chunks_with_claims: projectChunks.filter(c => c.claims_with_footnotes && c.claims_with_footnotes.length > 0).length,
      })
    } else if (projectText) {
      // Process text project
      projectChunks = chunkProjectText(projectText, 3)
      log(runId, "PROJECT_CHUNKED", { total_chunks: projectChunks.length })
    }

    if (projectChunks.length === 0) {
      return NextResponse.json(
        { error: "No chunks extracted from project" },
        { status: 500 }
      )
    }

    /* ================= BATCH EMBED PROJECT CHUNKS ================= */
    
    log(runId, "BATCH_EMBEDDING_PROJECT_CHUNKS", { count: projectChunks.length })
    const projectChunkTexts = projectChunks.map(c => c.text)
    const projectChunkEmbeddings = await embedTextBatch(projectChunkTexts, runId)
    
    // Build source titles list once
    const sourceTitles = Array.from(
      new Map(
        allSourceChunks.map(c => [c.source_id, { id: c.source_id, title: c.source_title, type: c.source_type }])
      ).values()
    )

    /* ================= BATCH NORMALIZE ALL FOOTNOTES ================= */
    
    // Collect all unique footnotes from all chunks
    const allUniqueFootnotes = Array.from(
      new Set(
        projectChunks
          .flatMap(c => c.claims_with_footnotes || [])
          .map(c => c.footnote_text)
          .filter(f => f && f.length > 10)
      )
    )
    
    // Also collect footnote numbers for tracking
    const allFootnoteNumbers = Array.from(
      new Set(
        projectChunks
          .flatMap(c => c.claims_with_footnotes || [])
          .map(c => c.footnote_number)
      )
    ).sort((a, b) => a - b)
    
    log(runId, "BATCH_NORMALIZING_FOOTNOTES", { 
      count: allUniqueFootnotes.length,
      footnote_numbers: allFootnoteNumbers,
      total_footnotes_in_paper: allFootnotes.size,
      footnotes_with_claims: allFootnoteNumbers.length
    })
    
    const footnoteNormalizations = allUniqueFootnotes.length > 0
      ? await normalizeCitationsBatch(allUniqueFootnotes, sourceTitles, runId)
      : new Map()
    
    // Log normalization results
    const matchedCount = footnoteNormalizations.size
    const unmatchedCount = allUniqueFootnotes.length - matchedCount
    log(runId, "FOOTNOTE_NORMALIZATION_COMPLETE", {
      total_footnotes: allUniqueFootnotes.length,
      matched_to_sources: matchedCount,
      unmatched: unmatchedCount,
      match_rate: allUniqueFootnotes.length > 0 ? (matchedCount / allUniqueFootnotes.length).toFixed(2) : 0,
      matches: Array.from(footnoteNormalizations.entries()).map(([citation, match]) => ({
        citation_preview: citation.slice(0, 80),
        source_title: sourceTitles.find(s => s.id === match.source_id)?.title,
        confidence: match.confidence
      }))
    })

    /* ================= ANALYZE EACH PROJECT CHUNK ================= */

    const analyses: ProjectChunkAnalysis[] = []
    const sourceMatchCounts = new Map<string, number>()
    const sourceSimilarities = new Map<string, number[]>()
    let totalSimilaritySum = 0
    let totalSimilarityCount = 0

    for (let idx = 0; idx < projectChunks.length; idx++) {
      const projectChunk = projectChunks[idx]
      const chunkEmbedding = projectChunkEmbeddings[idx]

      // Find matching source chunks using cosine similarity (optimized)
      const similarityScores: Array<{ chunk: SourceChunk; similarity: number }> = []
      
      for (const sourceChunk of allSourceChunks) {
        const similarity = cosineSimilarity(chunkEmbedding, sourceChunk.embedding)
        if (similarity > 0.3) {
          similarityScores.push({ chunk: sourceChunk, similarity })
        }
      }

      // Sort and take top matches
      similarityScores.sort((a, b) => b.similarity - a.similarity)
      const topMatches = similarityScores.slice(0, 10).map(({ chunk, similarity }) => ({
        chunk_id: chunk.id,
        source_id: chunk.source_id,
        source_title: chunk.source_title,
        source_type: chunk.source_type,
        text: chunk.text,
        page_number: chunk.page_number,
        paragraph_index: chunk.paragraph_index,
        similarity,
      }))

      const sourceIds = new Set<string>()

      for (const match of topMatches) {
        sourceIds.add(match.source_id)
        sourceMatchCounts.set(
          match.source_id,
          (sourceMatchCounts.get(match.source_id) || 0) + 1
        )

        if (!sourceSimilarities.has(match.source_id)) {
          sourceSimilarities.set(match.source_id, [])
        }
        sourceSimilarities.get(match.source_id)!.push(match.similarity)

        totalSimilaritySum += match.similarity
        totalSimilarityCount++
      }

      const avgSimilarity =
        topMatches.length > 0
          ? topMatches.reduce((sum, m) => sum + m.similarity, 0) / topMatches.length
          : 0
      const maxSimilarity =
        topMatches.length > 0 ? Math.max(...topMatches.map(m => m.similarity)) : 0

      // Verify claims with footnotes against sources (normative analysis)
      const claimVerifications: ClaimVerification[] = []
      if (projectChunk.claims_with_footnotes && projectChunk.claims_with_footnotes.length > 0) {
        log(runId, "VERIFYING_CLAIMS_IN_CHUNK", {
          chunk_index: projectChunk.chunk_index,
          claims_count: projectChunk.claims_with_footnotes.length,
          footnote_numbers: projectChunk.claims_with_footnotes.map(c => c.footnote_number)
        })
        
        // Process claims sequentially to avoid overwhelming Claude API
        // But batch process multiple claims together when possible
        for (const claim of projectChunk.claims_with_footnotes) {
          const normalization = footnoteNormalizations.get(claim.footnote_text)
          if (normalization) {
            const sourceInfo = sourceTitles.find(s => s.id === normalization.source_id)
            if (sourceInfo) {
              log(runId, "VERIFYING_CLAIM", {
                footnote_number: claim.footnote_number,
                source_title: normalization.normalized_title,
                citation_match_confidence: normalization.confidence,
                claim_preview: claim.claim_text.slice(0, 100)
              })
              
              const verification = await verifyClaimAgainstSource(
                claim,
                {
                  source_id: normalization.source_id,
                  source_title: normalization.normalized_title,
                  source_type: sourceInfo.type,
                  confidence: normalization.confidence,
                },
                allSourceChunks,
                runId
              )
              claimVerifications.push(verification)
              
              log(runId, "CLAIM_VERIFICATION_COMPLETE", {
                footnote_number: claim.footnote_number,
                verification_score: verification.verification_score,
                supporting_chunks_count: verification.supporting_chunks.length,
                source_title: verification.source_title,
                assessment: verification.overall_assessment?.slice(0, 100)
              })
              
              // Update source counts from verifications
              sourceIds.add(verification.source_id)
              sourceMatchCounts.set(
                verification.source_id,
                (sourceMatchCounts.get(verification.source_id) || 0) + verification.supporting_chunks.length
              )
            } else {
              log(runId, "CLAIM_NO_SOURCE_MATCH", {
                footnote_number: claim.footnote_number,
                citation_preview: claim.footnote_text.slice(0, 80)
              }, "WARN")
            }
          } else {
            log(runId, "CLAIM_NO_CITATION_MATCH", {
              footnote_number: claim.footnote_number,
              citation_preview: claim.footnote_text.slice(0, 80)
            }, "WARN")
          }
          
          // Small delay between verifications to avoid rate limiting
          await sleep(200)
        }
      }

      analyses.push({
        chunk_index: projectChunk.chunk_index,
        text: projectChunk.text,
        char_start: projectChunk.char_start,
        char_end: projectChunk.char_end,
        page_number: projectChunk.page_number,
        claims_with_footnotes: projectChunk.claims_with_footnotes,
        claim_verifications: claimVerifications.length > 0 ? claimVerifications : undefined,
        matches: topMatches,
        avg_similarity: avgSimilarity,
        max_similarity: maxSimilarity,
        sources_represented: Array.from(sourceIds),
      })
    }

    log(runId, "ANALYSIS_COMPLETE", {
      total_chunks_analyzed: analyses.length,
    })

    /* ================= CALCULATE OVERALL STATS ================= */

    const overallAvgSimilarity =
      totalSimilarityCount > 0 ? totalSimilaritySum / totalSimilarityCount : 0

    // Count footnotes matched and verified
    let footnotesMatched = 0
    let claimsVerified = 0
    const sourceFootnoteCounts = new Map<string, number>()
    
    for (const analysis of analyses) {
      if (analysis.claim_verifications && analysis.claim_verifications.length > 0) {
        footnotesMatched += analysis.claim_verifications.length
        claimsVerified += analysis.claim_verifications.filter(v => v.verification_score > 0.5).length
        for (const verification of analysis.claim_verifications) {
          const count = sourceFootnoteCounts.get(verification.source_id) || 0
          sourceFootnoteCounts.set(verification.source_id, count + 1)
        }
      }
    }

    // Reconstruct source details from match counts
    const sourcesCoveredDetails: Array<{
      source_id: string
      source_title: string
      source_type: string
      match_count: number
      avg_similarity: number
      footnote_matches: number
    }> = []

    // Get source IDs from all chunks
    const uniqueSourceIds = new Set<string>()
    for (const chunk of allSourceChunks) {
      uniqueSourceIds.add(chunk.source_id)
    }

    for (const sourceId of uniqueSourceIds) {
      const count = sourceMatchCounts.get(sourceId) || 0
      const footnoteCount = sourceFootnoteCounts.get(sourceId) || 0

      const similarities = sourceSimilarities.get(sourceId) || []
      const avgSim =
        similarities.length > 0
          ? similarities.reduce((a, b) => a + b, 0) / similarities.length
          : 0

      const chunk = allSourceChunks.find(c => c.source_id === sourceId)
      if (chunk) {
        sourcesCoveredDetails.push({
          source_id: sourceId,
          source_title: chunk.source_title,
          source_type: chunk.source_type,
          match_count: count,
          avg_similarity: avgSim,
          footnote_matches: footnoteCount,
        })
      }
    }

    sourcesCoveredDetails.sort((a, b) => b.match_count - a.match_count)

    let chunksWithHighSim = 0
    let chunksWithMediumSim = 0
    let chunksWithLowSim = 0

    for (const analysis of analyses) {
      if (analysis.max_similarity > 0.7) {
        chunksWithHighSim++
      } else if (analysis.max_similarity >= 0.5) {
        chunksWithMediumSim++
      } else {
        chunksWithLowSim++
      }
    }

    // Calculate average verification score
    const allVerifications = analyses.flatMap(a => a.claim_verifications || [])
    const avgVerificationScore = allVerifications.length > 0
      ? allVerifications.reduce((sum, v) => sum + v.verification_score, 0) / allVerifications.length
      : 0

    // Calculate detailed citation verification statistics
    const verificationStats = {
      total_footnotes_in_paper: allFootnotes.size,
      footnotes_with_claims_extracted: analyses.reduce((sum, a) => sum + (a.claims_with_footnotes?.length || 0), 0),
      footnotes_matched_to_sources: footnotesMatched,
      claims_verified: claimsVerified,
      claims_strongly_supported: allVerifications.filter(v => v.verification_score >= 0.7).length,
      claims_partially_supported: allVerifications.filter(v => v.verification_score >= 0.5 && v.verification_score < 0.7).length,
      claims_weakly_supported: allVerifications.filter(v => v.verification_score > 0 && v.verification_score < 0.5).length,
      claims_not_supported: allVerifications.filter(v => v.verification_score === 0).length,
      avg_verification_score: avgVerificationScore,
      sources_with_footnote_matches: sourcesCoveredDetails.filter(s => s.footnote_matches > 0).length,
    }

    // Collect all footnotes with their status for the UI
    const allFootnotesList = Array.from(allFootnotes.values()).sort((a, b) => a.number - b.number)
    const footnotesWithStatus = allFootnotesList.map(fn => {
      // Find if this footnote has any verifications
      const verifications = analyses
        .flatMap(a => a.claim_verifications || [])
        .filter(v => v.footnote_number === fn.number)
      
      const claims = analyses
        .flatMap(a => a.claims_with_footnotes || [])
        .filter(c => c.footnote_number === fn.number)
      
      return {
        footnote_number: fn.number,
        footnote_text: fn.text,
        page_number: fn.page_number,
        has_verification: verifications.length > 0,
        verification_score: verifications.length > 0 
          ? verifications.reduce((sum, v) => sum + v.verification_score, 0) / verifications.length
          : 0,
        matched_source: verifications.length > 0 ? verifications[0].source_title : null,
        has_claim: claims.length > 0,
      }
    })

    // Create the result object
    const result: AnalysisResult = {
      project_chunks: analyses,
      overall_stats: {
        total_chunks: analyses.length,
        total_footnotes: allFootnotes.size,
        footnotes_matched: footnotesMatched,
        claims_verified: claimsVerified,
        avg_verification_score: avgVerificationScore,
        avg_similarity_across_all: overallAvgSimilarity,
        sources_covered: sourcesCoveredDetails.length,
        sources_covered_details: sourcesCoveredDetails,
        chunks_with_high_similarity: chunksWithHighSim,
        chunks_with_medium_similarity: chunksWithMediumSim,
        chunks_with_low_similarity: chunksWithLowSim,
        all_footnotes: footnotesWithStatus,
      },
    }

    log(runId, "CITATION_VERIFICATION_SUMMARY", verificationStats)
    
    log(runId, "RESULT_COMPLETE", {
      total_chunks: result.overall_stats.total_chunks,
      sources_covered: result.overall_stats.sources_covered,
      avg_similarity: result.overall_stats.avg_similarity_across_all,
      citation_verification: verificationStats,
    })

    return NextResponse.json(result)
  } catch (err: any) {
    log(runId, "FATAL_ERROR", {
      error: err?.message,
      stack: err?.stack,
      name: err?.name,
    }, "ERROR")
    return NextResponse.json(
      { error: "Internal error", details: err?.message, stack: process.env.NODE_ENV === "development" ? err?.stack : undefined },
      { status: 500 }
    )
  }
}
