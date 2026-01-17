// =======================================================
// FILE: lib/reasoning/diversityRewardSystem.test.ts
// PURPOSE: Test examples for the Diversity Reward System
// =======================================================

import { evaluateDiversityMetrics, calculateDiversityRewards, assessDiversityInsurance } from './diversityRewardSystem'

// Example reasoning output with poor diversity (over-reliance on single source)
const poorDiversityOutput = {
  sections: [
    {
      section_index: 1,
      title: "Legal Analysis",
      paragraphs: [
        {
          paragraph_index: 1,
          text: "The statute clearly establishes jurisdiction.",
          evidence_ids: ["statute_001_chunk_1", "statute_001_chunk_2"],
          citations: [
            {
              evidence_id: "statute_001_chunk_1",
              usage_type: "direct" as const,
              char_start: 0,
              char_end: 50,
              quoted_text: "establishes jurisdiction"
            }
          ]
        },
        {
          paragraph_index: 2,
          text: "Furthermore, the statute provides additional guidance.",
          evidence_ids: ["statute_001_chunk_3"],
          citations: [
            {
              evidence_id: "statute_001_chunk_3",
              usage_type: "reference" as const
            }
          ]
        }
      ]
    }
  ]
}

// Example with good diversity (balanced across sources)
const goodDiversityOutput = {
  sections: [
    {
      section_index: 1,
      title: "Legal Analysis",
      paragraphs: [
        {
          paragraph_index: 1,
          text: "The statute establishes jurisdiction, as confirmed by case law.",
          evidence_ids: ["statute_001_chunk_1", "case_001_chunk_1", "article_001_chunk_1"],
          citations: [
            {
              evidence_id: "statute_001_chunk_1",
              usage_type: "direct" as const,
              char_start: 0,
              char_end: 50,
              quoted_text: "establishes jurisdiction"
            },
            {
              evidence_id: "case_001_chunk_1",
              usage_type: "substantial" as const,
              excerpt: "confirmed by case law"
            }
          ]
        },
        {
          paragraph_index: 2,
          text: "Scholarly analysis supports this interpretation.",
          evidence_ids: ["article_001_chunk_2", "book_001_chunk_1"],
          citations: [
            {
              evidence_id: "article_001_chunk_2",
              usage_type: "reference" as const
            },
            {
              evidence_id: "book_001_chunk_1",
              usage_type: "reference" as const
            }
          ]
        }
      ]
    }
  ]
}

// Example source metadata
const sourceMetadata = [
  { id: "statute_001", type: "statute", title: "Communications Act 1934" },
  { id: "case_001", type: "case", title: "Smith v. FCC" },
  { id: "article_001", type: "journal_article", title: "Telecommunications Regulation" },
  { id: "book_001", type: "book", title: "Communications Law Handbook" }
]

// Create evidence-to-source mapping for test
const evidenceToSourceMap = new Map<string, string>([
  ["statute_001_chunk_1", "statute_001"],
  ["statute_001_chunk_2", "statute_001"],
  ["statute_001_chunk_3", "statute_001"],
  ["case_001_chunk_1", "case_001"],
  ["article_001_chunk_1", "article_001"],
  ["article_001_chunk_2", "article_001"],
  ["book_001_chunk_1", "book_001"]
])

// Test function (can be run to see diversity assessments)
export function testDiversityRewardSystem() {
  console.log("=== DIVERSITY REWARD SYSTEM TEST ===\n")

  console.log("TEST 1: Poor Diversity Output")
  const poorAssessment = assessDiversityInsurance(poorDiversityOutput, sourceMetadata, evidenceToSourceMap)
  console.log(`Diversity Score: ${poorAssessment.metrics.overallDiversityScore}/100`)
  console.log(`Total Reward: ${poorAssessment.rewards.totalReward}`)
  console.log(`Should Regenerate: ${poorAssessment.shouldRegenerate}`)
  console.log(`Max Concentration: ${poorAssessment.metrics.maxSourceCitationPercentage.toFixed(1)}%`)
  console.log("Recommendations:")
  poorAssessment.rewards.recommendations.forEach(rec => console.log(`- ${rec}`))
  console.log()

  console.log("TEST 2: Good Diversity Output")
  const goodAssessment = assessDiversityInsurance(goodDiversityOutput, sourceMetadata, evidenceToSourceMap)
  console.log(`Diversity Score: ${goodAssessment.metrics.overallDiversityScore}/100`)
  console.log(`Total Reward: ${goodAssessment.rewards.totalReward}`)
  console.log(`Should Regenerate: ${goodAssessment.shouldRegenerate}`)
  console.log(`Max Concentration: ${goodAssessment.metrics.maxSourceCitationPercentage.toFixed(1)}%`)
  console.log("Recommendations:")
  goodAssessment.rewards.recommendations.forEach(rec => console.log(`- ${rec}`))
  console.log()

  console.log("=== DIVERSITY REWARD SYSTEM TEST COMPLETE ===\n")

  // Run edge case tests
  testEdgeCases()
}

// Test edge cases
export function testEdgeCases() {
  console.log("=== EDGE CASE TESTS ===\n")

  // Test with no citations
  const noCitationsOutput = {
    sections: [{
      section_index: 1,
      title: "Test",
      paragraphs: [{
        paragraph_index: 1,
        text: "Some text without citations",
        evidence_ids: ["chunk1", "chunk2"],
        citations: []
      }]
    }]
  }

  try {
    const noCitationsAssessment = assessDiversityInsurance(noCitationsOutput, sourceMetadata, evidenceToSourceMap)
    console.log("No citations test passed:", noCitationsAssessment.metrics.overallDiversityScore)
  } catch (error) {
    console.error("No citations test failed:", error)
  }

  // Test with empty output
  const emptyOutput = {
    sections: []
  }

  try {
    const emptyAssessment = assessDiversityInsurance(emptyOutput, sourceMetadata, evidenceToSourceMap)
    console.log("Empty output test passed:", emptyAssessment.metrics.overallDiversityScore)
  } catch (error) {
    console.error("Empty output test failed:", error)
  }

  console.log("=== EDGE CASE TESTS COMPLETE ===\n")
}

// Example usage in production code:
/*
import { assessDiversityInsurance } from '@/lib/reasoning/diversityRewardSystem'

const assessment = assessDiversityInsurance(reasoningOutput, sourceMetadata, evidenceToSourceMap)

if (assessment.shouldRegenerate) {
  // Trigger regeneration with diversity feedback
  console.log("Regenerating due to poor diversity:", assessment.rewards.recommendations)
}

// Include in response
return {
  ...result,
  diversity_score: assessment.metrics.overallDiversityScore,
  diversity_feedback: assessment.rewards.recommendations
}
*/