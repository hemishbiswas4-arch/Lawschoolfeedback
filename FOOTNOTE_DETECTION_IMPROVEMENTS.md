# Comprehensive Footnote Detection & Verification System

## Overview

This system provides comprehensive footnote extraction and citation verification for academic PDFs. It's designed to handle various footnote formats commonly used in academic papers, including superscript markers.

## Key Features

### 1. **Multi-Format Footnote Detection**
- **Bottom-of-page footnotes**: Detects footnotes in the bottom 20-30% of pages
- **Superscript markers**: Identifies superscript footnote numbers in main text using:
  - Font size analysis (smaller than main text)
  - Y-position analysis (positioned above baseline)
  - Context-aware detection

### 2. **Comprehensive Reference Linking**
- Links footnote references in main text to footnote definitions
- Supports multiple formats:
  - `[1]` or `[1, 2, 3]` (bracketed)
  - `(1)` (parenthetical)
  - Superscript numbers (detected via PDF structure)
  - Numbers after words/punctuation

### 3. **Citation Verification**
- Matches footnote citations to uploaded source documents
- Uses AI to normalize citation formats (Chicago Manual, legal citations, etc.)
- Verifies claims against source chunks with normative analysis

### 4. **Detailed Logging & Debugging**
- Logs footnote extraction statistics
- Tracks citation matching rates
- Provides verification scores for each claim
- Debug logs for superscript detection

## How It Works

### Step 1: Footnote Extraction
1. Scans each page for footnotes in the bottom area
2. Identifies footnote numbers and text
3. Uses fallback detection if standard method finds nothing

### Step 2: Superscript Detection
1. Analyzes PDF structure to find potential superscript markers
2. Compares font sizes and Y-positions
3. Maps superscript numbers to footnote definitions

### Step 3: Claim Extraction
1. Finds footnote references in main text
2. Extracts full sentences containing footnotes
3. Links claims to their footnote citations

### Step 4: Citation Matching
1. Normalizes citation formats using AI
2. Matches citations to uploaded source documents
3. Calculates confidence scores

### Step 5: Verification
1. Verifies each claim against cited source chunks
2. Uses normative analysis (not just text similarity)
3. Provides verification scores and reasoning

## Usage

1. Navigate to `/reverse-engineer` in your app
2. Upload source PDFs (the documents cited in your paper)
3. Upload your project PDF
4. Click "Analyze Relationship to Sources"
5. Review results:
   - Total footnotes found
   - Footnotes matched to sources
   - Verification scores for each claim
   - Supporting chunks from sources

## Logging & Debugging

The system provides detailed logs:
- `FOOTNOTE_EXTRACTION_DEBUG`: Shows what's found on each page
- `POTENTIAL_SUPERSCRIPT_MARKERS`: Lists detected superscript numbers
- `FOOTNOTES_EXTRACTED`: Summary of all footnotes found
- `CITATION_VERIFICATION_SUMMARY`: Overall verification statistics

## Comparison with Other Tools

### Commercial Tools Available:
- **CiteGuard**: Legal citation verification (focused on legal sources)
- **CiteShield**: Legal citation verification for briefs
- **SemanticCite**: Semantic analysis for academic papers
- **CiteTrue**: Cross-references with academic databases
- **Citely**: Citation checker and source finder

### Our System Advantages:
- **Open-source and customizable**
- **Handles multiple citation formats**
- **Works with your own source documents**
- **Provides normative verification (not just text matching)**
- **Comprehensive logging for debugging**
- **Handles superscript footnote markers**

## Improvements Made

1. **Enhanced Superscript Detection**
   - Analyzes PDF structure (font size, Y-position)
   - Detects numbers positioned above baseline
   - Maps superscripts to footnote definitions

2. **Better Claim Extraction**
   - Extracts full sentences containing footnotes
   - Uses sentence boundaries for cleaner text
   - Handles multiple footnote formats

3. **Robust Error Handling**
   - Fallback detection methods
   - Comprehensive error logging
   - Graceful degradation

4. **Detailed Statistics**
   - Tracks all footnotes found
   - Shows citation matching rates
   - Provides verification scores

## Next Steps

If footnotes still aren't being detected:
1. Check the debug logs (`FOOTNOTE_EXTRACTION_DEBUG`)
2. Review `POTENTIAL_SUPERSCRIPT_MARKERS` logs
3. Verify PDF format (some PDFs have footnotes in non-standard locations)
4. Consider PDF preprocessing if needed

## Technical Details

- Uses PDF.js for PDF parsing
- Employs Cohere embeddings for semantic matching
- Uses Claude (via Bedrock) for citation normalization and verification
- Handles various PDF coordinate systems
- Supports multi-page footnote extraction
