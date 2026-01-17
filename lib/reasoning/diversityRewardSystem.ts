// =======================================================
// FILE: lib/reasoning/diversityRewardSystem.ts
// PURPOSE: Diversity Insurance Reward System for Source Citation Balance
// =======================================================

export interface DiversityMetrics {
  // Source distribution
  totalSources: number
  citationsPerSource: Record<string, number>
  citationPercentages: Record<string, number>

  // Source type balance
  primaryLawSources: number
  secondarySources: number
  primaryLawCitationPercentage: number

  // Concentration metrics
  maxSourceCitationPercentage: number
  giniCoefficient: number // Measure of inequality in citation distribution

  // Diversity score (0-100)
  overallDiversityScore: number
}

export interface DiversityRewards {
  // Reward components
  balanceBonus: number         // Bonus for even citation distribution
  sourceTypeBonus: number      // Bonus for primary/secondary balance
  concentrationPenalty: number // Penalty for over-reliance on single sources

  // Total reward (can be positive or negative)
  totalReward: number

  // Recommendations for improvement
  recommendations: string[]
}

export interface ReasoningOutput {
  sections: Array<{
    section_index: number
    title: string
    paragraphs: Array<{
      paragraph_index: number
      text: string
      evidence_ids: string[]
      citations: Array<{
        evidence_id: string
        usage_type: 'direct' | 'substantial' | 'reference'
        char_start?: number
        char_end?: number
        quoted_text?: string
        excerpt?: string
      }>
    }>
  }>
}

export interface SourceMetadata {
  id: string
  type: string
  title: string
}

/**
 * Evaluates diversity metrics for a generated reasoning output
 */
export function evaluateDiversityMetrics(
  output: ReasoningOutput,
  sourceMetadata: SourceMetadata[],
  evidenceToSourceMap?: Map<string, string>
): DiversityMetrics {
  // Build evidence ID to source mapping
  const evidenceToSource = evidenceToSourceMap || new Map<string, string>()
  const sourceToType = new Map<string, string>()

  for (const source of sourceMetadata) {
    sourceToType.set(source.id, source.type)
  }

  // If no explicit mapping provided, try to extract source IDs from evidence IDs
  // Assumes evidence IDs contain source IDs as prefixes (e.g., "source_001_chunk_1")
  if (!evidenceToSourceMap) {
    // Collect all unique evidence IDs first
    const allEvidenceIds = new Set<string>()
    for (const section of output.sections) {
      for (const paragraph of section.paragraphs) {
        for (const evidenceId of paragraph.evidence_ids) {
          allEvidenceIds.add(evidenceId)
        }
      }
    }

    // Try to map evidence IDs to source IDs
    for (const evidenceId of allEvidenceIds) {
      // Look for patterns like "source_xxx" in the evidence ID
      const sourceMatch = evidenceId.match(/^([^_]+_[^_]+)/)
      if (sourceMatch) {
        const potentialSourceId = sourceMatch[1]
        // Check if this matches a known source
        if (sourceMetadata.some(s => s.id === potentialSourceId)) {
          evidenceToSource.set(evidenceId, potentialSourceId)
        }
      }
    }
  }

  // Collect all citations and their sources
  const citationCounts = new Map<string, number>()
  const allEvidenceIds = new Set<string>()

  for (const section of output.sections) {
    for (const paragraph of section.paragraphs) {
      // Track evidence IDs used
      for (const evidenceId of paragraph.evidence_ids) {
        allEvidenceIds.add(evidenceId)
      }

      // Count citations per source
      for (const citation of paragraph.citations || []) {
        const sourceId = evidenceToSource.get(citation.evidence_id)
        if (sourceId && sourceId.trim()) {
          citationCounts.set(sourceId, (citationCounts.get(sourceId) || 0) + 1)
        } else {
          // Log missing mapping for debugging (optional)
          console.warn(`Diversity assessment: No source mapping found for evidence ID ${citation.evidence_id}`)
        }
      }
    }
  }

  // Map evidence IDs to sources (assuming evidence IDs contain source info or we need to look them up)
  // For now, we'll assume evidence IDs are prefixed with source IDs or we have a mapping
  // This would need to be adjusted based on actual evidence ID format

  const sourceCitationCounts: Record<string, number> = {}
  let totalCitations = 0

  for (const [sourceId, count] of citationCounts.entries()) {
    sourceCitationCounts[sourceId] = count
    totalCitations += count
  }

  // Calculate source type counts
  let primaryLawSources = 0
  let primaryLawCitations = 0

  const primaryLawTypes = new Set(['statute', 'treaty', 'regulation', 'constitution', 'case'])

  for (const [sourceId, citations] of Object.entries(sourceCitationCounts)) {
    const sourceType = sourceToType.get(sourceId) || 'unknown'
    if (primaryLawTypes.has(sourceType)) {
      primaryLawSources++
      primaryLawCitations += citations
    }
  }

  const secondarySources = Object.keys(sourceCitationCounts).length - primaryLawSources

  // Calculate percentages
  const citationPercentages: Record<string, number> = {}
  if (totalCitations > 0) {
    for (const [sourceId, citations] of Object.entries(sourceCitationCounts)) {
      citationPercentages[sourceId] = (citations / totalCitations) * 100
    }
  } else {
    // If no citations, assign equal percentages to all sources
    const equalPercentage = sourceCitationCounts.length > 0 ? 100 / sourceCitationCounts.length : 0
    for (const sourceId of Object.keys(sourceCitationCounts)) {
      citationPercentages[sourceId] = equalPercentage
    }
  }

  // Calculate concentration metrics
  const maxSourceCitationPercentage = Math.max(...Object.values(citationPercentages), 0)

  // Calculate Gini coefficient (measure of inequality)
  const giniCoefficient = calculateGiniCoefficient(Object.values(sourceCitationCounts))

  // Calculate primary law percentage
  const primaryLawCitationPercentage = totalCitations > 0 ? (primaryLawCitations / totalCitations) * 100 : 0

  // Calculate overall diversity score (0-100)
  const overallDiversityScore = calculateOverallDiversityScore({
    totalSources: Object.keys(sourceCitationCounts).length,
    maxSourceCitationPercentage,
    giniCoefficient,
    primaryLawCitationPercentage,
    primaryLawSources,
    secondarySources
  })

  return {
    totalSources: Object.keys(sourceCitationCounts).length,
    citationsPerSource: sourceCitationCounts,
    citationPercentages,
    primaryLawSources,
    secondarySources,
    primaryLawCitationPercentage,
    maxSourceCitationPercentage,
    giniCoefficient,
    overallDiversityScore
  }
}

/**
 * Calculates diversity rewards and penalties
 */
export function calculateDiversityRewards(metrics: DiversityMetrics): DiversityRewards {
  const { totalSources, maxSourceCitationPercentage, giniCoefficient, primaryLawCitationPercentage, overallDiversityScore } = metrics

  let balanceBonus = 0
  let sourceTypeBonus = 0
  let concentrationPenalty = 0

  // Balance bonus: reward even distribution
  // Lower Gini coefficient = more even distribution = higher bonus
  if (totalSources >= 3) {
    balanceBonus = Math.max(0, 20 - (giniCoefficient * 20)) // Up to 20 points for perfect balance
  }

  // Source type bonus: reward balance between primary and secondary sources
  if (primaryLawCitationPercentage >= 30 && primaryLawCitationPercentage <= 70) {
    sourceTypeBonus = 15 // Sweet spot for primary/secondary balance
  } else if (primaryLawCitationPercentage >= 20 && primaryLawCitationPercentage <= 80) {
    sourceTypeBonus = 10 // Acceptable range
  }

  // Concentration penalty: penalize over-reliance on single sources
  if (maxSourceCitationPercentage > 50) {
    concentrationPenalty = -20 // Heavy penalty for >50% from one source
  } else if (maxSourceCitationPercentage > 40) {
    concentrationPenalty = -10 // Moderate penalty for >40% from one source
  } else if (maxSourceCitationPercentage > 30) {
    concentrationPenalty = -5 // Light penalty for >30% from one source
  }

  const totalReward = balanceBonus + sourceTypeBonus + concentrationPenalty

  // Generate recommendations
  const recommendations: string[] = []

  if (maxSourceCitationPercentage > 40) {
    recommendations.push(`Reduce reliance on dominant source (${maxSourceCitationPercentage.toFixed(1)}% of citations)`)
  }

  if (totalSources < 3) {
    recommendations.push("Incorporate citations from at least 3 different sources")
  }

  if (primaryLawCitationPercentage < 30) {
    recommendations.push("Increase citations from primary law sources (statutes, cases, regulations)")
  } else if (primaryLawCitationPercentage > 70) {
    recommendations.push("Balance with more secondary sources (scholarship, commentary)")
  }

  if (giniCoefficient > 0.6) {
    recommendations.push("Distribute citations more evenly across sources")
  }

  return {
    balanceBonus,
    sourceTypeBonus,
    concentrationPenalty,
    totalReward,
    recommendations
  }
}

/**
 * Calculates Gini coefficient for citation distribution
 * Gini = 0: perfect equality, Gini = 1: perfect inequality
 */
function calculateGiniCoefficient(values: number[]): number {
  if (values.length === 0) return 0
  if (values.length === 1) return 0

  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  let sum = 0

  for (let i = 0; i < n; i++) {
    sum += (i + 1) * sorted[i]
  }

  const total = sorted.reduce((a, b) => a + b, 0)
  if (total === 0) return 0

  const mean = total / n
  return (2 * sum) / (n * n * mean) - (n + 1) / n
}

/**
 * Calculates overall diversity score (0-100)
 */
function calculateOverallDiversityScore(params: {
  totalSources: number
  maxSourceCitationPercentage: number
  giniCoefficient: number
  primaryLawCitationPercentage: number
  primaryLawSources: number
  secondarySources: number
}): number {
  let score = 0

  // Source count component (up to 30 points)
  if (params.totalSources >= 5) score += 30
  else if (params.totalSources >= 3) score += 20
  else if (params.totalSources >= 2) score += 10

  // Balance component (up to 30 points)
  // Lower Gini = higher score
  const balanceScore = Math.max(0, 30 - (params.giniCoefficient * 30))
  score += balanceScore

  // Concentration component (up to 20 points)
  // Lower max percentage = higher score
  let concentrationScore = 20
  if (params.maxSourceCitationPercentage > 50) concentrationScore = 0
  else if (params.maxSourceCitationPercentage > 40) concentrationScore = 5
  else if (params.maxSourceCitationPercentage > 30) concentrationScore = 10
  else if (params.maxSourceCitationPercentage > 20) concentrationScore = 15
  score += concentrationScore

  // Source type balance (up to 20 points)
  let typeBalanceScore = 0
  if (params.primaryLawCitationPercentage >= 30 && params.primaryLawCitationPercentage <= 70) {
    typeBalanceScore = 20
  } else if (params.primaryLawCitationPercentage >= 20 && params.primaryLawCitationPercentage <= 80) {
    typeBalanceScore = 15
  } else if (params.primaryLawCitationPercentage >= 10 && params.primaryLawCitationPercentage <= 90) {
    typeBalanceScore = 10
  }
  score += typeBalanceScore

  return Math.min(100, Math.max(0, score))
}

/**
 * Generates diversity reward text for inclusion in prompts
 */
export function generateDiversityRewardText(rewards: DiversityRewards): string {
  const { totalReward, balanceBonus, sourceTypeBonus, concentrationPenalty, recommendations } = rewards

  let rewardText = `
DIVERSITY REWARD SYSTEM:
Your output will receive a diversity reward/penalty score: ${totalReward > 0 ? '+' : ''}${totalReward}

REWARD COMPONENTS:
- Balance Bonus: +${balanceBonus} (even citation distribution across sources)
- Source Type Bonus: +${sourceTypeBonus} (balance between primary law and secondary sources)
- Concentration Penalty: ${concentrationPenalty} (penalty for over-reliance on single sources)

DIVERSITY TARGETS FOR MAXIMUM REWARD:
- Cite from at least 3 different sources
- No single source should provide more than 30-40% of citations
- Balance primary law sources (30-70% of citations) with secondary sources
- Distribute citations as evenly as possible across available sources

${recommendations.length > 0 ? `IMPROVEMENT RECOMMENDATIONS:\n${recommendations.map(r => `- ${r}`).join('\n')}` : 'Excellent diversity achieved!'}

This score will influence the quality assessment of your response.`

  return rewardText
}

/**
 * Evaluates diversity and returns complete assessment
 */
export function assessDiversityInsurance(
  output: ReasoningOutput,
  sourceMetadata: SourceMetadata[],
  evidenceToSourceMap?: Map<string, string>
): {
  metrics: DiversityMetrics
  rewards: DiversityRewards
  assessment: string
  shouldRegenerate: boolean
} {
  const metrics = evaluateDiversityMetrics(output, sourceMetadata, evidenceToSourceMap)
  const rewards = calculateDiversityRewards(metrics)
  const assessment = generateDiversityRewardText(rewards)

  // Determine if regeneration is recommended
  const shouldRegenerate = metrics.overallDiversityScore < 50 ||
                          metrics.maxSourceCitationPercentage > 50 ||
                          metrics.totalSources < 2

  return {
    metrics,
    rewards,
    assessment,
    shouldRegenerate
  }
}