// =======================================================
// FILE: lib/reasoning/buildReasoningPrompt.ts
// PURPOSE: Step 3.3 — Deterministic Reasoning Prompt Builder
// =======================================================

type EvidenceChunk = {
  id: string
  source_id: string
  page_number: number
  paragraph_index: number
  chunk_index: number
  content: string
}

type BuildReasoningPromptInput = {
  query_text: string
  chunks: EvidenceChunk[]
}

export function buildReasoningPrompt({
  query_text,
  chunks,
}: BuildReasoningPromptInput): string {
  if (!chunks || chunks.length === 0) {
    throw new Error("No evidence chunks provided")
  }

  /* ---------- Evidence enumeration (UUID-based) ---------- */

  const evidenceSection = chunks
    .map(chunk =>
      [
        `[${chunk.id}]`,
        `Source ID: ${chunk.source_id}`,
        `Page Number: ${chunk.page_number}`,
        `Paragraph Index: ${chunk.paragraph_index}`,
        `Content:`,
        chunk.content.trim(),
        ``,
      ].join("\n")
    )
    .join("\n")

  /* ---------- Prompt assembly ---------- */

  return `
SYSTEM ROLE
You are a legal-reasoning engine operating in an audit-critical research system.

You are performing STEP 3: REASONED SYNTHESIS.
All evidence has already been retrieved, ranked, and fixed.

---------------------------------------------
NON-NEGOTIABLE CONSTRAINTS
---------------------------------------------
- You may ONLY rely on the evidence provided below.
- You may NOT use prior knowledge or background doctrine.
- You may NOT invent facts or interpretations.
- Every paragraph MUST cite at least one evidence ID.
- Evidence IDs MUST match the UUIDs exactly.
- Output MUST be valid JSON and NOTHING ELSE.

---------------------------------------------
STRUCTURE (STRICT — SHORT FORM)
---------------------------------------------
- Produce EXACTLY 3 sections.
- Each section MUST contain EXACTLY 2 paragraphs.
- Each paragraph MUST be between 80 and 100 words.
- Do NOT exceed these limits.

---------------------------------------------
HOW TO WRITE
---------------------------------------------
This is NOT a summary.

Each paragraph MUST:
- Make a clear argumentative claim.
- Use the cited evidence to SUPPORT or QUALIFY that claim.
- Explain the implication of the evidence for the argument.

Do NOT paraphrase evidence mechanically.
Do NOT introduce material not grounded in the evidence.

---------------------------------------------
QUERY
---------------------------------------------
${query_text}

---------------------------------------------
EVIDENCE (READ-ONLY)
---------------------------------------------
${evidenceSection}

---------------------------------------------
OUTPUT FORMAT (JSON ONLY)
---------------------------------------------
Return ONLY valid JSON in the following structure:

{
  "sections": [
    {
      "section_index": 1,
      "title": "string",
      "paragraphs": [
        {
          "paragraph_index": 1,
          "text": "formal academic prose advancing a clear argument",
          "evidence_ids": ["<chunk-uuid>"]
        }
      ]
    }
  ]
}

---------------------------------------------
PROHIBITIONS
---------------------------------------------
- No markdown
- No commentary
- No explanations
- No apologies
- No meta-discussion
- No text outside the JSON object
- No missing fields
`.trim()
}
