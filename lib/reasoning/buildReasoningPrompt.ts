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
  // NEW: Enhanced metadata from document-type-aware chunking
  metadata?: {
    section_header?: string
    case_citations?: string[]
    statute_references?: string[]
    detected_patterns?: string[]
    heading_context?: string
  }
}

type ArgumentationLine = {
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

type Approach = {
  argumentation_line?: ArgumentationLine
  // NEW: Support for combined argumentation lines
  combined_lines?: ArgumentationLine[]
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
  
  // Create source metadata for inline citations
  const sourceMetadata = new Map<string, { title: string, type: string, abbreviation: string }>()
  for (const source of source_details) {
    const type = source.type
    let abbreviation = ""
    let title = source.title

    // Create abbreviated citations
    switch (type) {
      case "case":
        abbreviation = title.split(" v. ")[0] || title.substring(0, 30) // Just plaintiff name or truncated title
        break
      case "statute":
        abbreviation = title.replace(/\s+(Act|Code|Law)$/i, "").substring(0, 30)
        break
      case "regulation":
        abbreviation = title.substring(0, 30)
        break
      case "treaty":
      case "constitution":
        abbreviation = title.substring(0, 40)
        break
      case "journal_article":
      case "book":
      case "commentary":
        // Extract author/year if possible
        const authorMatch = title.match(/^([^,]+),\s*(\d{4})/)
        if (authorMatch) {
          abbreviation = `${authorMatch[1]}, ${authorMatch[2]}`
        } else {
          abbreviation = title.substring(0, 30)
        }
        break
      default:
        abbreviation = title.substring(0, 30)
    }

    sourceMetadata.set(source.id, { title, type, abbreviation })
  }

  const evidenceSection = chunks
    .map(chunk => {
      const sourceType = sourceIdToType.get(chunk.source_id) || "unknown"
      const sourceTypeLabel = sourceTypeLabels[sourceType] || sourceType
      const sourceMeta = sourceMetadata.get(chunk.source_id)
      const sourceChunks = chunksBySource.get(chunk.source_id) || []
      const chunkPosition = sourceChunks.findIndex(c => c.id === chunk.id)
      const isAdjacent = chunkPosition > 0 || chunkPosition < sourceChunks.length - 1
      const isPrimaryLaw = ['statute', 'treaty', 'regulation', 'constitution'].includes(sourceType)

      // Add context note for primary law chunks that are part of a sequence
      const contextNote = isPrimaryLaw && isAdjacent && sourceChunks.length > 1
        ? `\nNOTE: This chunk is part of a sequence from ${sourceTypeLabel}. Read it together with adjacent chunks from the same source for complete legal context.`
        : ""

      // Build enhanced metadata section if available
      const chunkMetadata = chunk.metadata
      let metadataSection = ""
      if (chunkMetadata) {
        const metadataLines: string[] = []
        if (chunkMetadata.section_header) {
          metadataLines.push(`Section: ${chunkMetadata.section_header}`)
        }
        if (chunkMetadata.heading_context) {
          metadataLines.push(`Context: ${chunkMetadata.heading_context}`)
        }
        if (chunkMetadata.case_citations && chunkMetadata.case_citations.length > 0) {
          metadataLines.push(`Case Citations: ${chunkMetadata.case_citations.slice(0, 5).join("; ")}`)
        }
        if (chunkMetadata.statute_references && chunkMetadata.statute_references.length > 0) {
          metadataLines.push(`Statute Refs: ${chunkMetadata.statute_references.slice(0, 5).join("; ")}`)
        }
        if (chunkMetadata.detected_patterns && chunkMetadata.detected_patterns.length > 0) {
          metadataLines.push(`Patterns: ${chunkMetadata.detected_patterns.join(", ")}`)
        }
        if (metadataLines.length > 0) {
          metadataSection = `\n${metadataLines.join("\n")}`
        }
      }

      return [
        `[${chunk.id}]`,
        `Source ID: ${chunk.source_id}`,
        `Source Type: ${sourceTypeLabel}`,
        `Source Title: ${sourceMeta?.title || "Unknown"}`,
        `Citation Abbrev: ${sourceMeta?.abbreviation || sourceTypeLabel}`,
        `Page Number: ${chunk.page_number}`,
        `Paragraph Index: ${chunk.paragraph_index}`,
        `Chunk Index: ${chunk.chunk_index}${contextNote}${metadataSection}`,
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

  if (effectiveWordLimit) {
    if (effectiveWordLimit > DEFAULT_MAX_TOTAL_WORDS) {
      // Calculate structure to accommodate larger word limits
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
    } else if (effectiveWordLimit < DEFAULT_MAX_TOTAL_WORDS) {
      // Calculate structure to accommodate smaller word limits
      // Use average of 110 words per paragraph for calculation
      const avgWordsPerParagraph = 110
      const totalParagraphsNeeded = Math.ceil(effectiveWordLimit / avgWordsPerParagraph)

      // For smaller outputs, reduce the number of sections and paragraphs
      // Minimum 2 sections, maximum 4 sections for smaller outputs
      minSections = Math.max(2, Math.min(4, Math.ceil(totalParagraphsNeeded / 3)))

      // Adjust paragraphs per section based on total needed
      minParagraphsPerSection = Math.max(2, Math.floor(totalParagraphsNeeded / minSections))

      // For smaller outputs, allow shorter paragraphs
      minWordsPerParagraph = 60
      maxWordsPerParagraph = 120

      targetTotalWords = effectiveWordLimit
    }
  }

  /* ---------- Approach context ---------- */

  let approachContext = ""
  
  // Check for combined argumentation lines first
  if (approach?.combined_lines && approach.combined_lines.length > 1) {
    const lines = approach.combined_lines
    approachContext = `
COMBINED ARGUMENTATION APPROACH:
You are implementing a HYBRID approach that combines ${lines.length} complementary argumentation strategies.

${lines.map((line, idx) => `
APPROACH ${idx + 1}: ${line.title}
- Description: ${line.description}
- Method: ${line.approach}
- Focus Areas: ${line.focus_areas.join(", ")}
- Tone: ${line.tone}
`).join("")}

INTEGRATION GUIDANCE:
- Synthesize the perspectives from all ${lines.length} approaches into a coherent argument
- Draw on the strengths of each approach: ${lines.map(l => l.approach).join(", ")}
- Ensure the combined focus areas are addressed: ${[...new Set(lines.flatMap(l => l.focus_areas))].join(", ")}
- Maintain a consistent tone that balances: ${[...new Set(lines.map(l => l.tone))].join(" and ")}
- Use evidence that supports multiple approaches when possible to strengthen synthesis

PROPOSED STRUCTURE (merged from combined approaches):
${approach.sections?.map(s => `${s.section_index}. ${s.title} - ${s.description}`).join("\n  ") || lines[0].structure.sections.map(s => `${s.section_index}. ${s.title} - ${s.description}`).join("\n  ")}
`
  } else if (approach?.argumentation_line) {
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
You are a constrained academic legal-reasoning engine operating in an audit-critical research system.

You are performing STEP 3: SCHOLARLY SYNTHESIS.
All evidence has already been retrieved, ranked, and fixed through rigorous methodological protocols.
You MUST NOT perform retrieval, guessing, supplementation, or background explanation beyond the provided evidence.

Your task is to construct a rigorous, argumentative academic research output that contributes to legal scholarship, strictly from the evidence provided.

PROJECT TYPE: ${projectTypeContext}
${sourceContext}${sourceDetailsContext}
${approachContext ? `\n${approachContext}` : ""}

---------------------------------------------
CORE CONSTRAINTS (ABSOLUTE)
---------------------------------------------
- You may ONLY rely on the evidence chunks explicitly provided below.
- You may NOT use prior knowledge, training data, or general doctrine unless it is explicitly contained in the evidence.
- You may NOT invent facts, interpretations, or citations.
- Every paragraph MUST advance a clear analytical claim grounded in academic methodology.
- Every paragraph MUST cite at least one evidence ID.
- Evidence IDs MUST be chosen ONLY from the bracketed IDs provided below.
- Evidence IDs MUST be copied EXACTLY as shown (they are opaque identifiers).
- You MUST respect the output schema EXACTLY.
- Output MUST be valid JSON and nothing else.

---------------------------------------------
EVIDENCE SELECTION METHODOLOGY
---------------------------------------------
The evidence provided has been selected using Maximal Marginal Relevance (MMR) to ensure:
- HIGH RELEVANCE: Each chunk is semantically relevant to the research query
- DIVERSITY: Chunks represent different perspectives, sources, and source types
- BALANCED COVERAGE: No single source dominates; evidence is distributed across available sources

This means you should:
- LEVERAGE the diversity by incorporating multiple perspectives in your analysis
- SYNTHESIZE across source types (e.g., connect case law with statutory provisions)
- AVOID over-relying on any single source when alternatives exist
- USE the varied evidence to build comprehensive, well-supported arguments

---------------------------------------------
ACADEMIC SCHOLARSHIP REQUIREMENTS (CRITICAL)
---------------------------------------------
This is NOT a descriptive or summary task. You are constructing a scholarly academic work that contributes to legal discourse.

${approach?.tone
  ? `TONE REQUIREMENT: Write in a ${approach.tone} academic tone. ${approach.argumentation_line?.tone === approach.tone ? `This aligns with the selected argumentation approach.` : ""}
`
  : ""}
${approach?.focus_areas && approach.focus_areas.length > 0
  ? `FOCUS AREAS: Pay particular attention to: ${approach.focus_areas.join(", ")}. Ensure these areas are adequately addressed in your analysis.
`
  : ""}

ACADEMIC STRUCTURE REQUIREMENTS:
Each section MUST begin with a clear thesis statement that establishes the analytical framework and expected contribution to the scholarly debate.

Each paragraph MUST:
- Begin from an identifiable analytical position or claim situated within broader scholarly discourse
- Use one or more evidence chunks to:
  - support that claim through rigorous analysis,
  - qualify it with contextual nuance,
  - contrast it with alternative scholarly positions, or
  - expose theoretical tensions or doctrinal evolution between sources
- Include INLINE CITATIONS in the text using bracketed references like [Source A, p. 15] or [Case v. Case, 2023]
- Explicitly explain WHY the cited evidence supports the argument being made, connecting it to established scholarly frameworks
- Demonstrate methodological rigor by showing how evidence contributes to theoretical understanding
${approach?.argumentation_line?.approach
  ? `- Follow the ${approach.argumentation_line.approach} approach as outlined in the selected argumentation line`
  : ""}

You MUST NOT:
- Merely restate or paraphrase the evidence without theoretical analysis
- Produce generic synthesis without situating arguments within scholarly discourse
- Treat evidence as background context rather than building blocks of academic argument
- Present claims without methodological justification or theoretical grounding

You MAY:
- Build cumulative arguments across multiple paragraphs that develop a coherent scholarly narrative
- Return to the same evidence chunk in different argumentative contexts to show theoretical complexity
- Place different chunks in dialogue with one another to illuminate scholarly debates
- Employ academic transitions that connect ideas within broader theoretical frameworks
${approach?.combined_lines && approach.combined_lines.length > 1 ? `
COMBINED APPROACH INTEGRATION:
Since you are implementing a combined approach, you should:
- Weave together insights from the ${approach.combined_lines.length} complementary argumentation strategies
- Use evidence that supports multiple perspectives when possible
- Create transitions that connect different analytical frameworks
- Build a unified thesis that incorporates the strengths of each approach
- Ensure all combined focus areas receive appropriate attention
` : ""}

---------------------------------------------
ACADEMIC STRUCTURAL REQUIREMENTS (MANDATORY)
---------------------------------------------
${effectiveWordLimit && effectiveWordLimit > DEFAULT_MAX_TOTAL_WORDS
  ? `- TARGET WORD COUNT: Your output should aim for approximately ${targetTotalWords.toLocaleString()} words total.
- You MUST produce AT LEAST ${minSections} sections.
- Each section MUST contain AT LEAST ${minParagraphsPerSection} paragraphs.
- Each paragraph MUST be between ${minWordsPerParagraph} and ${maxWordsPerParagraph} words.
- The query requires comprehensive analysis, so ensure you fully develop your arguments across all sections.
`
  : effectiveWordLimit && effectiveWordLimit < DEFAULT_MAX_TOTAL_WORDS
  ? `- TARGET WORD COUNT: Your output should aim for approximately ${targetTotalWords.toLocaleString()} words total.
- You MUST produce AT LEAST ${minSections} sections.
- Each section MUST contain AT LEAST ${minParagraphsPerSection} paragraphs.
- Each paragraph MUST be between ${minWordsPerParagraph} and ${maxWordsPerParagraph} words.
- IMPORTANT: This is a concise analysis, so focus on the most essential arguments and evidence while maintaining scholarly rigor.
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

ACADEMIC ORGANIZATION PRINCIPLES:
- Each section MUST begin with a clear thesis statement establishing its scholarly contribution
- Sections MUST demonstrate methodological progression from theoretical foundations to empirical analysis to conclusions
- Analytical depth must come from argumentative reasoning grounded in evidence and situated within scholarly discourse
- You MAY cite multiple evidence IDs in a single paragraph to support complex theoretical arguments
${effectiveWordLimit && effectiveWordLimit > DEFAULT_MAX_TOTAL_WORDS
  ? `- IMPORTANT: Given the extended word limit, ensure comprehensive scholarly analysis that engages with theoretical frameworks, methodological approaches, and contributes to academic debate.`
  : ""}
- Do NOT collapse ideas to reduce paragraph count - academic rigor requires full development of theoretical arguments
- Include scholarly transitions between sections that connect ideas within broader theoretical frameworks
- Position arguments within existing scholarly debates and demonstrate original contributions
${effectiveWordLimit && effectiveWordLimit < DEFAULT_MAX_TOTAL_WORDS
  ? `- IMPORTANT: Given the concise word limit, prioritize the most critical scholarly arguments and evidence. Focus on core theoretical contributions rather than exhaustive analysis.`
  : effectiveWordLimit && effectiveWordLimit > DEFAULT_MAX_TOTAL_WORDS
  ? `- IMPORTANT: Given the extended word limit, ensure comprehensive scholarly analysis that engages with theoretical frameworks, methodological approaches, and contributes to academic debate.`
  : ""}
- Do NOT collapse ideas to reduce paragraph count - academic rigor requires full development of theoretical arguments

Failure to meet these academic structural requirements is a violation.

---------------------------------------------
ACADEMIC SOURCE TYPE AWARENESS (CRITICAL)
---------------------------------------------
You are constructing a scholarly work that engages with legal discourse. Consider the epistemological authority and methodological role of each source type within academic legal scholarship:

PRIMARY LAW SOURCES (Highest Authority - Foundational to Legal Scholarship):
- Case Law: Judicial decisions and precedents - cite for doctrinal development, judicial reasoning, and precedential authority within legal theory
- Statutes: Legislative enactments - cite for positive law and legislative intent. STATUTES ARE ESSENTIAL - if statutes are in the evidence, you MUST integrate them as foundational legal propositions.
- Regulations: Administrative rules - cite for regulatory frameworks and administrative law theory. REGULATIONS ARE BINDING LAW - cite them to demonstrate regulatory implementation.
- Constitution: Constitutional provisions - cite for constitutional theory and fundamental legal principles
- Treaties/Conventions: International agreements - cite for international legal theory. TREATIES/CONVENTIONS ARE BINDING - if present, you MUST cite them as authoritative sources of international obligation.

ACADEMIC / SECONDARY SOURCES (Interpretive Authority for Scholarly Analysis):
- Journal Articles: Scholarly analysis and critique - cite for theoretical frameworks, doctrinal critique, and scholarly debate positioning
- Books: Comprehensive treatments - cite for theoretical foundations and comprehensive doctrinal analysis
- Commentary/Textbooks: Doctrinal explanations - cite for established scholarly interpretations and theoretical synthesis
- Working Papers: Emerging scholarship - cite for innovative theoretical approaches and preliminary scholarly contributions
- Theses: Extended research - cite for detailed scholarly analysis and methodological approaches

POLICY / INSTITUTIONAL SOURCES (Contextual Authority for Applied Scholarship):
- Committee Reports, Law Commission Reports, White Papers, Government Reports: Policy analysis and recommendations - cite for policy theory, reform discourse, and institutional perspectives

DIGITAL / INFORMAL SOURCES (Contemporary Commentary for Contextual Analysis):
- Blog Posts, News Articles, Websites: Contemporary commentary - use sparingly within scholarly framework for current discourse analysis or public policy perspectives

ACADEMIC WEIGHTING AND METHODOLOGICAL GUIDANCE (CRITICAL):
- MANDATORY: When statutes, treaties, conventions, or regulations are available, you MUST integrate them as foundational elements of your scholarly argument, demonstrating their role in legal theory and doctrine.
- Statutes and Regulations: These represent positive law and administrative theory. If present, they should be cited early and frequently to establish the doctrinal framework of your analysis.
- Treaties and Conventions: These are sources of international legal theory. If present, they must be cited to demonstrate international legal frameworks and obligations.
- Prioritize primary law sources for establishing legal propositions, then use academic sources to provide theoretical interpretation, critique, and scholarly positioning.
- Employ academic sources to situate your analysis within broader scholarly debates, theoretical frameworks, and doctrinal development.
- Reference policy sources to demonstrate real-world application and institutional perspectives within scholarly discourse.
- Balance source types to create a comprehensive scholarly argument, ensuring primary law sources provide the doctrinal foundation while academic sources enable theoretical depth.

---------------------------------------------
ACADEMIC EVIDENCE METHODOLOGY (CRITICAL)
---------------------------------------------
Each evidence chunk represents a discrete unit of scholarly evidence that must be integrated into your academic argument:

EVIDENCE CHARACTERISTICS:
- A verbatim extract from a source document, preserving original scholarly or legal language
- Contextually bounded within its source document and methodological framework
- Independently citable as a discrete scholarly contribution
- Identified by a unique, opaque identifier (the bracketed ID) for academic traceability
- Tagged with its source type to enable appropriate epistemological weighting in scholarly analysis

ACADEMIC TREATMENT OF PRIMARY LAW SOURCES:
- Chunks from statutes, treaties, regulations, and conventions may be part of a doctrinal sequence
- When multiple chunks from the same primary law source are provided, they are ADJACENT chunks representing continuous legal doctrine
- These adjacent chunks should be synthesized as a unified doctrinal framework within your scholarly analysis
- A chunk may be truncated mid-doctrine, so adjacent chunks provide necessary theoretical and practical context
- When citing a statute/treaty/regulation chunk, systematically integrate adjacent chunks from the same source to demonstrate comprehensive doctrinal understanding
- Legal provisions often reference interconnected doctrinal elements - adjacent chunks may contain those theoretical linkages

ACADEMIC METHODOLOGICAL APPROACHES:
You MAY:
- Synthesize multiple chunks to construct comprehensive scholarly arguments
- Contrast chunks that represent different theoretical positions or doctrinal emphases within academic discourse
- Weight primary law sources as foundational elements of legal theory and doctrine
- Employ academic sources to construct theoretical frameworks and scholarly critique
- Integrate adjacent chunks from statutes/treaties/regulations as unified doctrinal propositions

You MUST:
- Integrate statutes, regulations, treaties, and conventions as foundational doctrinal elements when they appear in the evidence
- Prioritize primary law sources for establishing legal propositions while using academic sources for theoretical interpretation
- Ensure statutes and regulations are prominently featured as doctrinal foundations when available in the evidence
- When using a chunk from a statute/treaty/regulation, systematically consider adjacent chunks from the same source for comprehensive doctrinal context

You MAY NOT:
- Infer theoretical propositions beyond the explicit scholarly content of a chunk
- Treat a chunk as representative of an entire scholarly work without methodological justification
- Introduce theoretical concepts not grounded in the provided scholarly evidence
- Ignore source type when determining epistemological authority and theoretical weight within academic discourse

---------------------------------------------
QUERY
---------------------------------------------
${query_text}

---------------------------------------------
EVIDENCE (READ-ONLY — FIXED)
---------------------------------------------
${evidenceSection}

---------------------------------------------
ACADEMIC CITATION METHODOLOGY (CRITICAL)
---------------------------------------------
You MUST employ rigorous academic citation practices to ensure scholarly transparency, theoretical traceability, and intellectual accountability:

1. INLINE CITATION FORMAT: Use bracketed references within the paragraph text following academic conventions:
   - [Author, Year, p. Page] for scholarly sources (journal articles, books, working papers)
   - [Case Name, Year] for judicial decisions and doctrinal precedents
   - [Statute Name § Section] for legislative enactments and positive law
   - [Treaty Name, Article] for international legal instruments
   - [Institution, Year, p. Page] for policy and institutional sources

2. CITATION PLACEMENT AND SCHOLARLY INTEGRATION: Place citations immediately after the relevant theoretical claim or empirical evidence they support:
   - "The doctrinal framework establishes that judicial review requires substantive engagement with legislative intent [Smith v. Jones, 2023]."
   - "Section 5 of the statute provides the theoretical foundation for regulatory authority [Communications Act § 5]."
   - "The leading scholarly commentary suggests that this interpretation aligns with constitutional theory [Blackstone, 2022, p. 45]."

3. MULTIPLE SOURCE SYNTHESIS: When multiple sources converge on a theoretical point:
   - "This doctrinal interpretation is supported by both positive law and judicial reasoning [Tax Code § 102; Johnson v. IRS, 2021]."

4. THEORETICAL DIALOGUE THROUGH CITATION: When sources represent different scholarly positions:
   - "While the district court adopted a narrow doctrinal interpretation [Smith v. State, 2020], the appellate court developed a more expansive theoretical framework [Smith v. State, 2022]."

5. CITATION FOR SCHOLARLY POSITIONING: Use citations to situate your argument within academic discourse:
   - "This analysis builds upon established constitutional theory [Blackstone, 2022] while extending the doctrinal framework to contemporary challenges."

---------------------------------------------
GRANULAR CITATION REQUIREMENTS (CRITICAL)
---------------------------------------------
You MUST provide granular citations indicating exactly how evidence is used:

1. For DIRECT QUOTES: When you quote text verbatim from a chunk, you MUST:
   - Include the exact quoted text in the "direct_quotes" array
   - Specify the character position range within the chunk where the quote appears
   - Mark the usage_type as "direct"

2. For SUBSTANTIAL USE: When you paraphrase, summarize, or substantially rely on content from a chunk (even if not quoted), you MUST:
   - Include the relevant text excerpt or key phrase in "substantial_uses"
   - Specify the character position range within the chunk
   - Mark the usage_type as "substantial"

3. For GENERAL REFERENCE: When a chunk informs your argument but isn't directly quoted or substantially used, mark usage_type as "reference"

4. Character positions: Each chunk's content starts at position 0. When citing, provide the start and end character positions (0-indexed) within that chunk's content where the cited text appears.

5. Multiple citations: A single paragraph may cite the same chunk multiple times with different quotes/uses - include each as a separate citation entry.

Example citation structure:
- If chunk [abc123] contains: "The court held that the statute applies broadly."
- And you quote "applies broadly" (characters 25-40 in that chunk):
  {
    "evidence_id": "abc123",
    "usage_type": "direct",
    "char_start": 25,
    "char_end": 40,
    "quoted_text": "applies broadly"
  }

---------------------------------------------
ACADEMIC OUTPUT FORMAT (STRICT — JSON ONLY)
---------------------------------------------
Return ONLY valid JSON in the following exact scholarly structure:

{
  "sections": [
    {
      "section_index": 1,
      "title": "Academic Section Title Demonstrating Scholarly Focus",
      "paragraphs": [
        {
          "paragraph_index": 1,
          "text": "Formal academic legal prose employing scholarly discourse with INLINE CITATIONS [Source Abbrev, p. Page] advancing a clear theoretical claim situated within broader academic debate",
          "evidence_ids": ["<chunk-uuid-1>", "<chunk-uuid-2>"],
          "citations": [
            {
              "evidence_id": "<chunk-uuid-1>",
              "usage_type": "direct" | "substantial" | "reference",
              "char_start": 0,
              "char_end": 50,
              "quoted_text": "exact quoted text if usage_type is direct, otherwise null",
              "excerpt": "relevant excerpt or key phrase if usage_type is substantial, otherwise null"
            }
          ]
        }
      ]
    }
  ]
}

ACADEMIC CITATION RULES FOR SCHOLARLY INTEGRITY:
- Include bracketed citations like [Smith v. Jones, 2023] or [Tax Code § 5] within the paragraph text to maintain scholarly transparency
- Place citations immediately after the theoretical claim or empirical evidence they support to enable academic verification
- Use the "Citation Abbrev" provided for each chunk to create readable inline citations that facilitate scholarly engagement
- Ensure citations are integrated naturally into the academic prose flow while maintaining methodological rigor

ACADEMIC CITATION ACCOUNTABILITY RULES:
- Every evidence_id in "evidence_ids" MUST have at least one corresponding entry in "citations" to ensure complete scholarly traceability
- If you directly quote from a chunk, usage_type MUST be "direct" and quoted_text MUST contain the exact quote to preserve scholarly accuracy
- If you substantially rely on a chunk's content for theoretical analysis, usage_type MUST be "substantial" and excerpt MUST contain the relevant text to demonstrate methodological grounding
- If a chunk informs your scholarly argument but isn't directly quoted or substantially used, usage_type can be "reference" and quoted_text/excerpt can be null
- Character positions (char_start, char_end) MUST accurately reflect where the cited text appears within the chunk's content to enable scholarly verification
- Character positions are 0-indexed (first character is at position 0) following computational academic standards

---------------------------------------------
ACADEMIC INTEGRITY PROHIBITIONS (ENFORCED)
---------------------------------------------
- No markdown formatting that compromises scholarly presentation
- No meta-commentary that breaks academic voice
- No explanatory asides that interrupt scholarly discourse
- No apologetic language that undermines academic authority
- No meta-discussion that violates scholarly objectivity
- No text outside the JSON object that compromises data integrity
- No missing fields that would incomplete scholarly documentation
`.trim()
}
