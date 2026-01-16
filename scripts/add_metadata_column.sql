-- =======================================================
-- ADD METADATA_JSON COLUMN TO SOURCE_CHUNKS
-- =======================================================
-- Adds metadata storage for improved legal document retrieval
-- Run this SQL in your Supabase SQL editor
-- =======================================================

-- Add the metadata_json column to store extracted legal metadata
ALTER TABLE source_chunks
ADD COLUMN IF NOT EXISTS metadata_json JSONB;

-- Add a comment to explain the column purpose
COMMENT ON COLUMN source_chunks.metadata_json IS 'Extracted metadata for improved legal document retrieval (case citations, statute references, section headers, etc.)';

-- Optional: Create an index for better query performance on metadata
-- Uncomment if you want to search/filter by metadata frequently
-- CREATE INDEX IF NOT EXISTS idx_source_chunks_metadata ON source_chunks USING GIN (metadata_json);

-- =======================================================
-- VERIFICATION
-- =======================================================
-- Run this query to verify the column was added:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'source_chunks' AND column_name = 'metadata_json';