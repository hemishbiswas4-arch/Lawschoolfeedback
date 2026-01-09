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

type Approach = {
  argumentation_line?: {
    id: string
    title: string
    description: string
    approach: string
    focus_areas: string[]
    tone: string
    structure: {
      sections: Array<{
        section_index: number
        title: string
        description: string
      }>
    }
  }
  tone?: string
  structure_type?: string
  focus_areas?: string[]
  sections?: Array<{
    section_index: number
    title: string
    description: string
  }>
}

type SourceDetail = {
  id: string
  type: string
  title: string
}

type BuildReasoningPromptInput = {
  query_text: string
  chunks: EvidenceChunk[]
  project_type?: string
  approach?: Approach
  source_types?: Record<string, number>
  source_details?: SourceDetail[]
  word_limit?: number
}

export function buildReasoningPrompt({
  query_text,
  chunks,
  project_type = "research_paper",
  approach,
  source_types = {},
  source_details = [],
  word_limit,
}: BuildReasoningPromptInput): string {
  if (!chunks || chunks.length === 0) {
    throw new Error("No evidence chunks provided")
  }

  /* ---------- Source type context ---------- */

  const sourceTypeLabels: Record<string, string> = {
    case: "Case Law",
    statute: "Statute",
    regulation: "Regulation",
    constitution: "Constitution",
    treaty: "Treaty",
    journal_article: "Journal Article",
    book: "Book",
    commentary: "Commentary / Textbook",
    working_paper: "Working Paper",
    thesis: "Thesis / Dissertation",
    committee_report: "Committee Report",
    law_commission_report: "Law Commission Report",
    white_paper: "White Paper",
    government_report: "Government Report",
    blog_post: "Blog Post",
    news_article: "News Article",
    website: "Website",
    other: "Other",
  }

  const sourceContext = Object.keys(source_types).length > 0
    ? `\nSOURCE TYPES AVAILABLE:\n${Object.entries(source_types)
        .map(([type, count]) => `- ${sourceTypeLabels[type] || type}: ${count} source(s)`)
        .join("\n")}`
    : ""

  const sourceDetailsContext = source_details.length > 0
    ? `\nSOURCE DETAILS:\n${source_details
        .map(s => `- ${s.title} (${sourceTypeLabels[s.type] || s.type})`)
        .join("\n")}`
    : ""

  /* ---------- Evidence enumeration (UUID-based) with source type ---------- */

  const sourceIdToType = new Map<string, string>()
  for (const source of source_details) {
    sourceIdToType.set(source.id, source.type)
  }

  // Group chunks by source to identify adjacent chunks from statutes/conventions
  const chunksBySource = new Map<string, typeof chunks>()
  for (const chunk of chunks) {
    if (!chunksBySource.has(chunk.source_id)) {
      chunksBySource.set(chunk.source_id, [])
    }
    chunksBySource.get(chunk.source_id)!.push(chunk)
  }
  
  // Sort chunks within each source by chunk_index to identify adjacent chunks
  for (const [sourceId, sourceChunks] of chunksBySource.entries()) {
    sourceChunks.sort((a, b) => (a.chunk_index || 0) - (b.chunk_index || 0))
  }
  
  const evidenceSection = chunks
    .map(chunk => {
      const sourceType = sourceIdToType.get(chunk.source_id) || "unknown"
      const sourceTypeLabel = sourceTypeLabels[sourceType] || sourceType
      const sourceChunks = chunksBySource.get(chunk.source_id) || []
      const chunkPosition = sourceChunks.findIndex(c => c.id === chunk.id)
      const isAdjacent = chunkPosition > 0 || chunkPosition < sourceChunks.length - 1
      const isPrimaryLaw = ['statute', 'treaty', 'regulation', 'constitution'].includes(sourceType)
      
      // Add context note for primary law chunks that are part of a sequence
      const contextNote = isPrimaryLaw && isAdjacent && sourceChunks.length > 1
        ? `\nNOTE: This chunk is part of a sequence from ${sourceTypeLabel}. Read it together with adjacent chunks from the same source for complete legal context.`
        : ""
      
      return [
        `[${chunk.id}]`,
        `Source ID: ${chunk.source_id}`,
        `Source Type: ${sourceTypeLabel}${contextNote}`,
        `Page Number: ${chunk.page_number}`,
        `Paragraph Index: ${chunk.paragraph_index}`,
        `Chunk Index: ${chunk.chunk_index}`,
        `Content:`,
        chunk.content.trim(),
        ``,
      ].join("\n")
    })
    .join("\n")

  /* ---------- Project type context ---------- */

  const projectTypeDescriptions: Record<string, string> = {
    // Academic Research
    research_paper: "Academic research paper with comprehensive analysis, theoretical grounding, and scholarly rigor",
    literature_review: "Comprehensive review synthesizing existing scholarship, identifying gaps, and positioning contributions",
    systematic_review: "Systematic review following methodological protocols and rigorous review standards",
    empirical_study: "Research paper based on empirical data, statistical analysis, and evidence-based conclusions",
    theoretical_paper: "Paper focused on theoretical frameworks, conceptual analysis, and theoretical contributions",
    
    // Legal Documents
    legal_brief: "Formal legal brief or memorandum with clear legal arguments, case citations, and structured analysis",
    motion_brief: "Brief supporting or opposing a motion, with focused legal arguments and case law",
    appellate_brief: "Brief for appellate court proceedings, emphasizing legal errors and precedent",
    legal_memorandum: "Internal legal memorandum analyzing legal issues, risks, and recommendations",
    client_opinion: "Legal opinion letter providing client advice on legal matters and implications",
    
    // Case Analysis
    case_analysis: "Detailed case law analysis focusing on judicial reasoning, precedent, and doctrinal development",
    case_note: "Brief analysis of a specific case, highlighting key legal principles and implications",
    case_comment: "Critical commentary on a judicial decision, analyzing reasoning and potential impact",
    comparative_case_study: "Comparative analysis across multiple cases or jurisdictions, identifying patterns and differences",
    
    // Policy & Reform
    policy_analysis: "Policy evaluation document examining implications, alternatives, and recommendations",
    law_reform_paper: "Paper proposing legal reforms with policy recommendations and implementation strategies",
    regulatory_analysis: "Analysis of regulatory frameworks, compliance requirements, and regulatory impact",
    impact_assessment: "Assessment of legal or policy impacts, evaluating effectiveness and consequences",
    
    // Extended Academic Work
    thesis: "Extended academic work with deep analysis, original contributions, and comprehensive coverage",
    dissertation: "Doctoral-level extended research work with original research and significant contributions",
    masters_thesis: "Master's level extended research work with comprehensive analysis and original insights",
    capstone_project: "Capstone project integrating coursework and research, demonstrating mastery of subject",
    
    // Articles & Publications
    journal_article: "Article for academic or legal journal publication with focused argumentation and scholarly engagement",
    law_review_article: "Article for law review publication with rigorous legal analysis and scholarly contribution",
    opinion_piece: "Opinion piece or editorial with persuasive argumentation and clear position",
    book_chapter: "Chapter for edited volume or monograph, contributing to broader scholarly work",
    
    // Practice-Oriented
    practice_guide: "Guide for legal practitioners with practical advice and procedural guidance",
    compliance_manual: "Manual for regulatory compliance with step-by-step procedures and requirements",
    training_material: "Educational or training material with clear explanations and practical examples",
    
    // Other
    other: "Custom research output with flexible structure and approach",
  }

  const projectTypeContext = projectTypeDescriptions[project_type] || projectTypeDescriptions.research_paper

  /* ---------- Word limit calculation ---------- */
  
  // Default limits: 90-130 words per paragraph, minimum 6 sections × 3 paragraphs
  const DEFAULT_MIN_WORDS_PER_PARAGRAPH = 90
  const DEFAULT_MAX_WORDS_PER_PARAGRAPH = 130
  const DEFAULT_MIN_SECTIONS = 6
  const DEFAULT_MIN_PARAGRAPHS_PER_SECTION = 3
  const DEFAULT_MAX_TOTAL_WORDS = DEFAULT_MIN_SECTIONS * DEFAULT_MIN_PARAGRAPHS_PER_SECTION * DEFAULT_MAX_WORDS_PER_PARAGRAPH // ~2,340 words
  
  // Cap word_limit at 5000 as requested
  const MAX_ALLOWED_WORDS = 5000
  const effectiveWordLimit = word_limit 
    ? Math.min(word_limit, MAX_ALLOWED_WORDS)
    : undefined
  
  // Calculate dynamic structure requirements if word_limit is provided
  let minSections = DEFAULT_MIN_SECTIONS
  let minParagraphsPerSection = DEFAULT_MIN_PARAGRAPHS_PER_SECTION
  let minWordsPerParagraph = DEFAULT_MIN_WORDS_PER_PARAGRAPH
  let maxWordsPerParagraph = DEFAULT_MAX_WORDS_PER_PARAGRAPH
  let targetTotalWords = DEFAULT_MAX_TOTAL_WORDS
  
  if (effectiveWordLimit && effectiveWordLimit > DEFAULT_MAX_TOTAL_WORDS) {
    // Calculate structure to accommodate the word limit
    // Use average of 110 words per paragraph for calculation
    const avgWordsPerParagraph = 110
    const totalParagraphsNeeded = Math.ceil(effectiveWordLimit / avgWordsPerParagraph)
    
    // Distribute paragraphs across sections (aim for 3-5 paragraphs per section)
    const idealParagraphsPerSection = 4
    minSections = Math.max(DEFAULT_MIN_SECTIONS, Math.ceil(totalParagraphsNeeded / idealParagraphsPerSection))
    minParagraphsPerSection = Math.max(DEFAULT_MIN_PARAGRAPHS_PER_SECTION, Math.floor(totalParagraphsNeeded / minSections))
    
    // Adjust word range slightly to accommodate larger outputs
    // Keep paragraph length reasonable but allow more flexibility
    minWordsPerParagraph = 85
    maxWordsPerParagraph = 150
    targetTotalWords = effectiveWordLimit
  }

  /* ---------- Approach context ---------- */

  let approachContext = ""
  if (approach?.argumentation_line) {
    const line = approach.argumentation_line
    approachContext = `
SELECTED ARGUMENTATION APPROACH:
- Title: ${line.title}
- Description: ${line.description}
- Approach Type: ${line.approach}
- Focus Areas: ${line.focus_areas.join(", ")}
- Recommended Tone: ${line.tone}
- Proposed Structure: ${line.structure.sections.map(s => `${s.section_index}. ${s.title} - ${s.description}`).join("\n  ")}
`
  } else if (approach) {
    approachContext = `
SELECTED APPROACH CONFIGURATION:
- Tone: ${approach.tone || "analytical"}
- Structure Type: ${approach.structure_type || "traditional"}
- Focus Areas: ${approach.focus_areas?.join(", ") || "general analysis"}
${approach.sections ? `- Custom Sections:\n  ${approach.sections.map(s => `${s.section_index}. ${s.title} - ${s.description}`).join("\n  ")}` : ""}
`
  }

  /* ---------- Prompt assembly ---------- */

  return `
SYSTEM ROLE:
You are a constrained legal-reasoning engine operating in an audit-critical research system.

You are performing STEP 3: REASONED SYNTHESIS.
All evidence has already been retrieved, ranked, and fixed.
You MUST NOT perform retrieval, guessing, supplementation, or background explanation.

Your task is to construct a rigorous, argumentative research output strictly from the evidence provided.

PROJECT TYPE: ${projectTypeContext}
${sourceContext}${sourceDetailsContext}
${approachContext ? `\n${approachContext}` : ""}

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

${approach?.tone
  ? `TONE REQUIREMENT: Write in a ${approach.tone} tone. ${approach.argumentation_line?.tone === approach.tone ? `This aligns with the selected argumentation approach.` : ""}
`
  : ""}
${approach?.focus_areas && approach.focus_areas.length > 0
  ? `FOCUS AREAS: Pay particular attention to: ${approach.focus_areas.join(", ")}. Ensure these areas are adequately addressed in your analysis.
`
  : ""}

Each paragraph MUST:
- Begin from an identifiable analytical position or claim
- Use one or more evidence chunks to:
  - support that claim,
  - qualify it,
  - contrast it with another position, or
  - expose tension or evolution between sources
- Explicitly explain WHY the cited evidence supports the argument being made
${approach?.argumentation_line?.approach
  ? `- Follow the ${approach.argumentation_line.approach} approach as outlined in the selected argumentation line`
  : ""}

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
${effectiveWordLimit && effectiveWordLimit > DEFAULT_MAX_TOTAL_WORDS
  ? `- TARGET WORD COUNT: Your output should aim for approximately ${targetTotalWords.toLocaleString()} words total.
- You MUST produce AT LEAST ${minSections} sections.
- Each section MUST contain AT LEAST ${minParagraphsPerSection} paragraphs.
- Each paragraph MUST be between ${minWordsPerParagraph} and ${maxWordsPerParagraph} words.
- The query requires comprehensive analysis, so ensure you fully develop your arguments across all sections.
`
  : approach?.argumentation_line?.structure?.sections
  ? `- You MUST follow the proposed structure with ${approach.argumentation_line.structure.sections.length} sections as outlined above.
- Each section MUST contain AT LEAST ${minParagraphsPerSection} paragraphs.
- Each paragraph MUST be between ${minWordsPerParagraph} and ${maxWordsPerParagraph} words.
- Section titles should align with the proposed structure, but you may refine them based on evidence.
`
  : approach?.sections
  ? `- You MUST follow the custom structure with ${approach.sections.length} sections as outlined above.
- Each section MUST contain AT LEAST ${minParagraphsPerSection} paragraphs.
- Each paragraph MUST be between ${minWordsPerParagraph} and ${maxWordsPerParagraph} words.
- Section titles should align with the proposed structure, but you may refine them based on evidence.
`
  : `- You MUST produce AT LEAST ${minSections} sections.
- Each section MUST contain AT LEAST ${minParagraphsPerSection} paragraphs.
- Each paragraph MUST be between ${minWordsPerParagraph} and ${maxWordsPerParagraph} words.
`}
- Do NOT collapse ideas to reduce paragraph count.
- Analytical depth must come from argumentative reasoning grounded in the evidence.
- You MAY cite multiple evidence IDs in a single paragraph.
${effectiveWordLimit && effectiveWordLimit > DEFAULT_MAX_TOTAL_WORDS
  ? `- IMPORTANT: Given the extended word limit, ensure thorough analysis and comprehensive coverage of the evidence.`
  : ""}

Failure to meet these structural requirements is a violation.

---------------------------------------------
SOURCE TYPE AWARENESS (CRITICAL)
---------------------------------------------
You have access to evidence from different source types. Consider the authority and nature of each source:

PRIMARY LAW SOURCES (Highest Authority - MANDATORY TO USE WHEN AVAILABLE):
- Case Law: Judicial decisions and precedents - cite for legal principles and reasoning
- Statutes: Legislative enactments - cite for black-letter law. STATUTES ARE ESSENTIAL - if statutes are in the evidence, you MUST cite them prominently.
- Regulations: Administrative rules - cite for regulatory frameworks. REGULATIONS ARE BINDING LAW - cite them when available.
- Constitution: Constitutional provisions - cite for foundational principles
- Treaties/Conventions: International agreements - cite for international law. TREATIES/CONVENTIONS ARE BINDING - if present, you MUST cite them when discussing international obligations.

ACADEMIC / SECONDARY SOURCES (Interpretive Authority):
- Journal Articles: Scholarly analysis and critique - cite for academic perspectives
- Books: Comprehensive treatments - cite for theoretical frameworks
- Commentary/Textbooks: Doctrinal explanations - cite for established interpretations
- Working Papers: Emerging scholarship - cite for novel approaches
- Theses: Extended research - cite for detailed analysis

POLICY / INSTITUTIONAL SOURCES (Contextual Authority):
- Committee Reports, Law Commission Reports, White Papers, Government Reports: Policy analysis and recommendations - cite for policy context and reform proposals

DIGITAL / INFORMAL SOURCES (Lower Authority):
- Blog Posts, News Articles, Websites: Contemporary commentary - use sparingly, primarily for current events or public discourse

WEIGHTING GUIDANCE (CRITICAL):
- MANDATORY: When statutes, treaties, conventions, or regulations are available in the evidence, you MUST cite them prominently. These are binding legal sources and are essential for any legal argument.
- Statutes and Regulations: These represent black-letter law and binding legal rules. If statutes or regulations are present, they should be cited early and frequently in relevant sections.
- Treaties and Conventions: These are binding international law. If treaties/conventions are present, they must be cited when discussing international obligations or frameworks.
- Prioritize primary law sources (statutes, treaties, regulations, constitution, cases) for all legal propositions - they carry the highest authority.
- Use academic sources to support interpretations and theoretical frameworks, but do not rely on them alone when primary law sources are available.
- Reference policy sources for context and reform discussions.
- Balance source types appropriately, but ALWAYS ensure primary law sources are well-represented when available.

---------------------------------------------
CHUNK SEMANTICS (CRITICAL)
---------------------------------------------
Each evidence chunk is:
- A verbatim extract from a source document
- Contextually bounded
- Independently citable
- Identified by a unique, opaque identifier (the bracketed ID)
- Tagged with its source type for appropriate weighting

SPECIAL HANDLING FOR STATUTES, TREATIES, REGULATIONS, AND CONVENTIONS:
- Chunks from statutes, treaties, regulations, and conventions may be part of a sequence
- When multiple chunks from the same primary law source are provided, they are ADJACENT chunks
- These adjacent chunks should be read TOGETHER as they represent continuous legal provisions
- A chunk may be cut mid-provision, so adjacent chunks provide necessary context
- When citing a statute/treaty/regulation chunk, consider citing adjacent chunks from the same source if they provide relevant context
- Legal provisions often reference other sections - adjacent chunks may contain those references

You MAY:
- Combine multiple chunks to support a single argumentative move
- Contrast chunks that express different positions or emphases
- Weight primary law sources more heavily for legal propositions
- Use academic sources to support analytical frameworks
- Read adjacent chunks from statutes/treaties/regulations together as a continuous provision

You MUST:
- Cite statutes, regulations, treaties, and conventions when they appear in the evidence - these are binding legal sources
- Prioritize primary law sources over secondary sources when making legal claims
- Ensure statutes and regulations are prominently featured if they are available in the evidence
- When using a chunk from a statute/treaty/regulation, check if adjacent chunks from the same source provide necessary context

You MAY NOT:
- Infer facts beyond the explicit wording of a chunk
- Treat a chunk as summarising an entire document
- Introduce concepts not grounded in the provided text
- Ignore source type when determining authority and weight

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
