// =======================================================
// SHARED SOURCE TYPES CONSTANTS
// =======================================================
// Centralized definition of supported source types to keep
// frontend and backend aligned
// =======================================================

export const SUPPORTED_SOURCE_TYPES = [
  "case",
  "statute",
  "regulation",
  "constitution",
  "treaty",
  "journal_article",
  "book",
  "commentary",
  "other"
] as const

export type SourceType = typeof SUPPORTED_SOURCE_TYPES[number]

// Display names for UI
export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  case: "Court Case / Judgment",
  statute: "Law / Statute",
  regulation: "Regulation / Rule",
  constitution: "Constitution",
  treaty: "Treaty / International Agreement",
  journal_article: "Academic Article",
  book: "Book or Book Chapter",
  commentary: "Commentary / Textbook",
  other: "Other Document"
}

// Descriptions for UI
export const SOURCE_TYPE_DESCRIPTIONS: Record<SourceType, string> = {
  case: "Court decisions and judgments",
  statute: "Legislation passed by parliament",
  regulation: "Rules made under statutory authority",
  constitution: "Foundational legal documents",
  treaty: "International agreements",
  journal_article: "Peer-reviewed legal scholarship",
  book: "Comprehensive legal treatises",
  commentary: "Explanatory legal texts",
  other: "Any other relevant source type"
}