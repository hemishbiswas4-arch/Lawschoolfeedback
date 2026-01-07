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
    .map(chunk => {
      return [
        `[${chunk.id}]`,
        `Source ID: ${chunk.source_id}`,
        `Page Number: ${chunk.page_number}`,
        `Paragraph Index: ${chunk.paragraph_index}`,
        `Chunk Index: ${chunk.chunk_index}`,
        `Content:`,
        chunk.content.trim(),
        ``,
      ].join("\n")
    })
    .join("\n")

  /* ---------- Prompt assembly ---------- */

  return `
SYSTEM ROLE:
You are a constrained legal-reasoning engine operating in an audit-critical research system.

You are performing STEP 3: REASONED SYNTHESIS.
All evidence has already been retrieved, ranked, and fixed.
You MUST NOT perform retrieval, guessing, supplementation, or background explanation.

Your task is to construct a rigorous, argumentative academic research output strictly from the evidence provided.

---------------------------------------------
CORE CONSTRAINTS (ABSOLUTE)
---------------------------------------------
- You may ONLY rely on the evidence chunks explicitly provided below.
- You may NOT use prior knowledge, training data, or general doctrine unless it is explicitly contained in the evidence.
- You may NOT invent facts, interpretations, or citations.
- Every paragraph MUST advance a clear analytical claim.
- Every paragraph MUST cite at least one evidence ID.
- Evidence IDs MUST be chosen ONLY from the bracketed IDs provided below.
- Evidence IDs MUST be copied EXACTLY as shown (they are opaque identifiers).
- You MUST respect the output schema EXACTLY.
- Output MUST be valid JSON and nothing else.

---------------------------------------------
ARGUMENTATION REQUIREMENTS (CRITICAL)
---------------------------------------------
This is NOT a descriptive or summary task.

Each paragraph MUST:
- Begin from an identifiable analytical position or claim
- Use one or more evidence chunks to:
  - support that claim,
  - qualify it,
  - contrast it with another position, or
  - expose tension or evolution between sources
- Explicitly explain WHY the cited evidence supports the argument being made

You MUST NOT:
- Merely restate or paraphrase the evidence
- Produce generic synthesis without argumentative direction
- Treat evidence as background context

You MAY:
- Build cumulative arguments across multiple paragraphs
- Return to the same evidence chunk in different argumentative contexts
- Place different chunks in dialogue with one another

---------------------------------------------
STRUCTURAL LENGTH REQUIREMENTS (MANDATORY)
---------------------------------------------
- You MUST produce AT LEAST 6 sections.
- Each section MUST contain AT LEAST 3 paragraphs.
- Each paragraph MUST be between 90 and 130 words.
- Do NOT collapse ideas to reduce paragraph count.
- Analytical depth must come from argumentative reasoning grounded in the evidence.
- You MAY cite multiple evidence IDs in a single paragraph.

Failure to meet these structural requirements is a violation.

---------------------------------------------
CHUNK SEMANTICS (CRITICAL)
---------------------------------------------
Each evidence chunk is:
- A verbatim extract from a source document
- Contextually bounded
- Independently citable
- Identified by a unique, opaque identifier (the bracketed ID)

You MAY:
- Combine multiple chunks to support a single argumentative move
- Contrast chunks that express different positions or emphases

You MAY NOT:
- Infer facts beyond the explicit wording of a chunk
- Treat a chunk as summarising an entire document
- Introduce concepts not grounded in the provided text

---------------------------------------------
QUERY
---------------------------------------------
${query_text}

---------------------------------------------
EVIDENCE (READ-ONLY — FIXED)
---------------------------------------------
${evidenceSection}

---------------------------------------------
OUTPUT FORMAT (STRICT — JSON ONLY)
---------------------------------------------
Return ONLY valid JSON in the following exact structure:

{
  "sections": [
    {
      "section_index": 1,
      "title": "string",
      "paragraphs": [
        {
          "paragraph_index": 1,
          "text": "formal academic legal prose advancing a clear analytical claim",
          "evidence_ids": ["<chunk-uuid-1>", "<chunk-uuid-2>"]
        }
      ]
    }
  ]
}

---------------------------------------------
PROHIBITIONS (ENFORCED)
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
